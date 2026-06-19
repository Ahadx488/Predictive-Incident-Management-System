import pandas as pd
import numpy as np
import joblib
import faiss
import json
import warnings
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score, mean_absolute_error, mean_squared_error, r2_score, confusion_matrix
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors
from sentence_transformers import SentenceTransformer
from catboost import CatBoostClassifier, CatBoostRegressor

warnings.filterwarnings("ignore")
print("🚀 Booting Final Enterprise Traffic Intelligence Pipeline...")

# ==========================================
# 1. LOAD DATA & CLEANING
# ==========================================
raw_df = pd.read_csv("events.csv")
df = raw_df.drop_duplicates(subset=['start_datetime', 'latitude', 'longitude', 'event_cause']).copy()

df['start_datetime'] = pd.to_datetime(df['start_datetime'], errors='coerce', utc=True)
df['created_date'] = pd.to_datetime(df['created_date'], errors='coerce', utc=True)
df['effective_end_time'] = pd.to_datetime(df['closed_datetime'], errors='coerce', utc=True).fillna(pd.to_datetime(df['end_datetime'], errors='coerce', utc=True))

df = df.sort_values('start_datetime').reset_index(drop=True)

df['requires_road_closure'] = df['requires_road_closure'].astype(str).str.upper().str.strip().replace({'1': 'TRUE', '0': 'FALSE', 'Y': 'TRUE', 'N': 'FALSE', 'YES': 'TRUE', 'NO': 'FALSE'})
priority_map = {'1': 'Low', '2': 'Medium', '3': 'High', '4': 'Critical', '1.0': 'Low', '2.0': 'Medium', '3.0': 'High', '4.0': 'Critical'}
df['priority'] = df['priority'].astype(str).replace(priority_map).str.capitalize()

df = df.dropna(subset=['start_datetime', 'effective_end_time', 'requires_road_closure', 'priority', 'latitude', 'longitude'])
df = df[(df["latitude"].between(-90, 90)) & (df["longitude"].between(-180, 180))]

# Calculate Priority Target Determinism
cross_tab = pd.crosstab(df['event_cause'], df['priority'])
dominance_ratio = cross_tab.max(axis=1) / cross_tab.sum(axis=1)
priority_deterministic = bool(dominance_ratio.mean() > 0.95)

df['resolution_minutes'] = (df['effective_end_time'] - df['start_datetime']).dt.total_seconds() / 60.0
df = df[(df['resolution_minutes'] > 0) & (df['resolution_minutes'] < 1440)]
df['resolution_log'] = np.log1p(df['resolution_minutes'])

# ==========================================
# 2. FEATURE ENGINEERING
# ==========================================
df['hour'] = df['start_datetime'].dt.hour
df['time_slot'] = pd.cut(df['hour'], bins=[-1, 5, 9, 15, 19, 24], labels=["Night", "Morning Rush", "Day", "Evening Rush", "Night"], ordered=False).astype(str)

cat_features = ['event_type', 'event_cause', 'zone', 'junction', 'corridor', 'direction', 'time_slot']

for col in cat_features: df[col] = df[col].fillna("Unknown").astype(str)

df['junction_clean'] = df['junction'].str.lower().str.strip()
junction_counts = df['junction_clean'].value_counts()
df['junction_density'] = df['junction_clean'].map(junction_counts).fillna(0)
joblib.dump(junction_counts, "junction_counts.pkl")

df['lat_bucket'] = df['latitude'].round(3)
df['lon_bucket'] = df['longitude'].round(3)
loc_counts = df.groupby(['lat_bucket', 'lon_bucket']).size()
df['location_density'] = df.apply(lambda row: loc_counts.get((row['lat_bucket'], row['lon_bucket']), 0), axis=1)
joblib.dump(loc_counts, "location_counts.pkl")

# ==========================================
# 3. SPATIAL INTELLIGENCE
# ==========================================
coords = df[['latitude', 'longitude']].values
nn = NearestNeighbors(n_neighbors=5).fit(coords)
distances, _ = nn.kneighbors(coords)
optimal_eps = max(0.001, min(np.percentile(distances[:, 4], 90), 0.01))

dbscan = DBSCAN(eps=optimal_eps, min_samples=5)
df['cluster_id'] = dbscan.fit_predict(coords)

dataset_stats = {
    "raw_records": len(raw_df), 
    "usable_records": len(df), 
    "retention_rate": round((len(df) / len(raw_df)) * 100, 1),
    "clusters": int(df['cluster_id'].nunique() - (1 if -1 in df['cluster_id'].values else 0)),
    "max_loc_density": int(loc_counts.max()) if not loc_counts.empty else 1,
    "max_junc_density": int(junction_counts.max()) if not junction_counts.empty else 1
}
with open("dataset_stats.json", "w") as f: json.dump(dataset_stats, f)

valid_clusters = df[df['cluster_id'] != -1]
if not valid_clusters.empty:
    cluster_centroids = valid_clusters.groupby('cluster_id')[['latitude', 'longitude']].mean().reset_index()
else:
    cluster_centroids = pd.DataFrame({'cluster_id': [-1], 'latitude': [df['latitude'].mean()], 'longitude': [df['longitude'].mean()]})
cluster_centroids.to_pickle("cluster_centroids.pkl")

# ==========================================
# 4. FAISS EMBEDDINGS
# ==========================================
joblib.dump('all-MiniLM-L6-v2', "embedding_model.pkl")
embedder = SentenceTransformer('all-MiniLM-L6-v2')

df['semantic_text'] = (
    df['event_cause'] + " " + df['event_type'] + " " + 
    df['description'].fillna("") + " " + df['reason_breakdown'].fillna("") + " " + df['zone'] + " " + df['junction']
)

embeddings = embedder.encode(df['semantic_text'].tolist(), show_progress_bar=True)
faiss.normalize_L2(embeddings)
index = faiss.IndexFlatIP(embeddings.shape[1])
index.add(np.array(embeddings).astype('float32'))
faiss.write_index(index, "faiss_index.bin")

hist_cols = ['id', 'event_cause', 'event_type', 'description', 'zone', 'junction', 'priority', 'requires_road_closure', 'resolution_minutes']
df[hist_cols].to_pickle("historical_corpus.pkl")

# ==========================================
# 5. MODEL TRAINING (Temporal Holdout)
# ==========================================
X = df[cat_features + ['latitude', 'longitude', 'hour', 'cluster_id', 'junction_density', 'location_density']]
joblib.dump(X.columns.tolist(), "feature_order.pkl")

strat_col = df['priority'] if df['priority'].value_counts().min() >= 2 else None

X_train, X_test, ycl_tr, ycl_te, ypr_tr, ypr_te, yre_tr, yre_te = train_test_split(
    X, df['requires_road_closure'], df['priority'], df['resolution_log'], 
    test_size=0.2, shuffle=False 
)

cb_params = {'iterations': 500, 'learning_rate': 0.05, 'depth': 6, 'verbose': 0, 'cat_features': cat_features}

closure_model = CatBoostClassifier(**cb_params, auto_class_weights='Balanced').fit(X_train, ycl_tr)
priority_model = CatBoostClassifier(**cb_params, auto_class_weights='Balanced').fit(X_train, ypr_tr)
resolution_model = CatBoostRegressor(**cb_params).fit(X_train, yre_tr)

# ==========================================
# 6. METRICS & EXPORT
# ==========================================
cl_preds = closure_model.predict(X_test)
cl_probs = closure_model.predict_proba(X_test)
pr_preds = priority_model.predict(X_test)
pr_probs = priority_model.predict_proba(X_test)
re_preds = np.expm1(resolution_model.predict(X_test))
y_true_res = np.expm1(yre_te)

try:
    if len(priority_model.classes_) == 2:
        pos_idx = 1
        pr_roc_auc = roc_auc_score((ypr_te == priority_model.classes_[pos_idx]).astype(int), pr_probs[:, pos_idx])
    else:
        pr_roc_auc = roc_auc_score(ypr_te, pr_probs, multi_class='ovr')
except Exception: pr_roc_auc = None

try:
    cl_idx = list(closure_model.classes_).index('TRUE')
    cl_roc_auc = roc_auc_score((ycl_te == 'TRUE').astype(int), cl_probs[:, cl_idx])
except Exception: cl_roc_auc = None

model_metrics = {
    "priority_f1": round(f1_score(ypr_te, pr_preds, average='macro') * 100, 1),
    "priority_prec": round(precision_score(ypr_te, pr_preds, average='macro', zero_division=0) * 100, 1),
    "priority_rec": round(recall_score(ypr_te, pr_preds, average='macro', zero_division=0) * 100, 1),
    "priority_roc_auc": round(pr_roc_auc * 100, 1) if pr_roc_auc is not None else "N/A",
    "priority_deterministic": priority_deterministic,
    
    "closure_f1": round(f1_score(ycl_te, cl_preds, average='macro') * 100, 1),
    "closure_prec": round(precision_score(ycl_te, cl_preds, average='macro', zero_division=0) * 100, 1),
    "closure_rec": round(recall_score(ycl_te, cl_preds, average='macro', zero_division=0) * 100, 1),
    "closure_roc_auc": round(cl_roc_auc * 100, 1) if cl_roc_auc is not None else "N/A",
    
    "resolution_mae_hours": round(mean_absolute_error(y_true_res, re_preds) / 60.0, 1),
    "resolution_rmse_hours": round(np.sqrt(mean_squared_error(y_true_res, re_preds)) / 60.0, 1),
    "resolution_r2": round(r2_score(y_true_res, re_preds), 2)
}

with open("model_metrics.json", "w") as f: json.dump(model_metrics, f)

closure_model.save_model("closure_model.cbm")
priority_model.save_model("priority_model.cbm")
resolution_model.save_model("resolution_model.cbm")
joblib.dump(closure_model.classes_, "closure_classes.pkl")
joblib.dump(priority_model.classes_, "priority_classes.pkl")

print("✅ Training Pipeline Complete. Comprehensive Metrics Exported.")