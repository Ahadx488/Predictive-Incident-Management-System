from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd, numpy as np, joblib, faiss, json
from datetime import datetime, timedelta
from sentence_transformers import SentenceTransformer
from catboost import CatBoostClassifier, CatBoostRegressor, Pool

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

print("🚀 Starting Production ML API...")

closure_model = CatBoostClassifier().load_model("closure_model.cbm")
priority_model = CatBoostClassifier().load_model("priority_model.cbm")
resolution_model = CatBoostRegressor().load_model("resolution_model.cbm")

feature_order = joblib.load("feature_order.pkl")
closure_classes, priority_classes = joblib.load("closure_classes.pkl"), joblib.load("priority_classes.pkl")
junction_counts, location_counts = joblib.load("junction_counts.pkl"), joblib.load("location_counts.pkl")
cluster_centroids = pd.read_pickle("cluster_centroids.pkl")

with open("dataset_stats.json", "r") as f: dataset_stats = json.load(f)
with open("model_metrics.json", "r") as f: model_metrics = json.load(f)

embedder = SentenceTransformer(joblib.load("embedding_model.pkl"))
faiss_index = faiss.read_index("faiss_index.bin")
historical_corpus = pd.read_pickle("historical_corpus.pkl")

class IncidentRequest(BaseModel):
    event_type: str; event_cause: str; zone: str; junction: str
    corridor: str; direction: str; latitude: float; longitude: float
    description: str; reason_breakdown: str

@app.get("/stats")
def get_stats(): return {"dataset": dataset_stats, "models": model_metrics}

@app.post("/predict")
def predict_incident(req: IncidentRequest):
    now = datetime.now()
    j_den = float(junction_counts.get(req.junction.lower().strip(), 0))
    l_den = float(location_counts.get((round(req.latitude, 3), round(req.longitude, 3)), 0))
    
    # 1. Hotspot Distance & Map Coordinates
    if len(cluster_centroids) == 1 and cluster_centroids.iloc[0]['cluster_id'] == -1:
        cluster_id, nearest_hotspot_m, dist_band = -1, -1, "N/A"
        hs_lat, hs_lon = None, None
    else:
        lat_rad, lon_rad = np.radians(req.latitude), np.radians(req.longitude)
        cents = cluster_centroids[cluster_centroids['cluster_id'] != -1].copy()
        cent_lats, cent_lons = np.radians(cents['latitude']), np.radians(cents['longitude'])
        
        dlon = cent_lons - lon_rad
        dlat = cent_lats - lat_rad
        a = np.sin(dlat/2)**2 + np.cos(lat_rad) * np.cos(cent_lats) * np.sin(dlon/2)**2
        c = 2 * np.arcsin(np.sqrt(a))
        distances_km = 6371 * c
        
        nearest_idx = distances_km.idxmin()
        nearest_hotspot_m = int(distances_km.min() * 1000)
        cluster_id = int(cents.loc[nearest_idx, 'cluster_id'])
        hs_lat = float(cents.loc[nearest_idx, 'latitude'])
        hs_lon = float(cents.loc[nearest_idx, 'longitude'])
        
        if nearest_hotspot_m < 500: dist_band = "Hotspot"
        elif nearest_hotspot_m < 1000: dist_band = "Near"
        elif nearest_hotspot_m < 3000: dist_band = "Moderate"
        else: dist_band = "Remote"

    norm_loc = min(100, (l_den / dataset_stats.get("max_loc_density", 1)) * 100)
    norm_junc = min(100, (j_den / dataset_stats.get("max_junc_density", 1)) * 100)
    risk_score = (0.4 * norm_loc) + (0.4 * norm_junc) + (0.2 * (100 if dist_band == "Hotspot" else 0))
    risk_label = "Low" if risk_score < 30 else "Medium" if risk_score < 60 else "High"
    
    hour = now.hour
    time_slot = "Morning Rush" if 6 <= hour < 10 else "Day" if 10 <= hour < 16 else "Evening Rush" if 16 <= hour < 20 else "Night"

    input_data = pd.DataFrame([{
        "event_type": req.event_type, "event_cause": req.event_cause, "zone": req.zone,
        "junction": req.junction, "corridor": req.corridor, "direction": req.direction,
        "latitude": req.latitude, "longitude": req.longitude, "hour": hour,
        "cluster_id": cluster_id, "junction_density": j_den, "location_density": l_den, "time_slot": time_slot
    }])[feature_order]

    # 2. Model Predictions (Raw Probabilities, No Fake Caps)
    pr_probs = priority_model.predict_proba(input_data)[0]
    prio = priority_classes[np.argmax(pr_probs)]
    prio_conf = round(max(pr_probs)*100, 1)
    
    cl_probs = closure_model.predict_proba(input_data)[0]
    closure = closure_classes[np.argmax(cl_probs)]
    close_conf = round(max(cl_probs)*100, 1)
    
    res_time = max(5, int(round(np.expm1(resolution_model.predict(input_data)[0]))))
    res_hours, res_mins = res_time // 60, res_time % 60

    model_warnings = []
    if model_metrics.get('priority_f1', 0) > 99:
        model_warnings.append("Audit Flag: Priority model relies heavily on deterministic event classifications.")

    # 3. SEMANTIC OPERATIONAL SAFETY OVERRIDE LAYER
    desc = req.description.lower()
    closure_indicators = [
        "all lanes", "blocking all", "traffic stopped", "traffic completely stopped",
        "overturned", "pileup", "multi vehicle collision", "multiple vehicle collision",
        "major accident", "fatal accident", "immobilized", "entire carriageway",
        "no traffic movement", "queue length exceeds", "gridlock", "standstill",
        "vehicles stranded", "underpass submerged", "water level above",
        "traffic diverted", "emergency vehicles unable", "submerged"
    ]

    indicator_count = sum(1 for k in closure_indicators if k in desc)

    prio_score = {"Low": 20, "Medium": 50, "High": 80, "Critical": 100}.get(prio, 20)
    close_score = 100 if closure == "TRUE" else 0
    hotspot_score = 100 if dist_band == "Hotspot" else (75 if dist_band == "Near" else (50 if dist_band == "Moderate" else 20))
    density_score = (norm_loc + norm_junc) / 2

    # Apply override logically without fabricating ML confidence
    override_applied = False
    if indicator_count >= 1:
        if closure == "FALSE":
            closure = "TRUE"
            close_score = 100
            override_applied = True
            model_warnings.append("Operational Safety Override: Severe semantic indicators detected. Enforcing traffic restriction.")

    sev_components = {
        "Priority": round(0.35 * prio_score),
        "Closure": round(0.30 * close_score),
        "Hotspot": round(0.20 * hotspot_score),
        "Density": round(0.15 * density_score)
    }
    
    operational_severity = sum(sev_components.values())
    cause_lower = req.event_cause.lower()
    
    if cause_lower in ['vehicle_breakdown', 'accident', 'treefall', 'pot_hole', 'pothole', 'protest']:
        operational_severity = max(30, operational_severity)
        
    if indicator_count >= 1:
        operational_severity = max(operational_severity, 85) # Floor raised to 85 for catastrophic events

    if operational_severity <= 30: sev_band = "LOW"
    elif operational_severity <= 60: sev_band = "MODERATE"
    elif operational_severity <= 80: sev_band = "HIGH"
    else: sev_band = "CRITICAL"

    # 4. SHAP Extraction
    pool = Pool(input_data, cat_features=['event_type', 'event_cause', 'zone', 'junction', 'corridor', 'direction', 'time_slot'])
    shap_raw = priority_model.get_feature_importance(pool, type='ShapValues')
    instance_shap = np.abs(shap_raw[0, :-1, :]).mean(axis=1) if len(shap_raw.shape) == 3 else shap_raw[0, :-1]
    total_impact = np.sum(np.abs(instance_shap)) + 1e-9
    
    top_shap = []
    for i, name in enumerate(feature_order):
        top_shap.append({"feature": name.replace('_', ' ').title(), "impact": round((np.abs(instance_shap[i]) / total_impact) * 100, 1)})
    top_shap = sorted(top_shap, key=lambda x: x['impact'], reverse=True)[:5]

    narrative_reasons = []
    if top_shap[0]['impact'] > 80:
        narrative_reasons.append(f"Model prediction is highly determined by {top_shap[0]['feature']} ({top_shap[0]['impact']}%).")
    else:
        narrative_reasons.append(f"Primary predictive drivers are {top_shap[0]['feature']} and {top_shap[1]['feature']}.")
    if dist_band in ["Hotspot", "Near"]:
        narrative_reasons.append(f"Elevated risk identified due to proximity ({nearest_hotspot_m}m) to a known historical traffic hotspot.")
    if closure == "TRUE":
        narrative_reasons.append("Location profile strongly correlates with traffic restrictions.")

    # 5. FAISS Semantic Search
    query_vec = embedder.encode([f"{req.event_cause} {req.event_type} {req.description} {req.reason_breakdown} {req.zone} {req.junction}"]).astype('float32')
    faiss.normalize_L2(query_vec)
    distances, indices = faiss_index.search(query_vec, 3)
    
    similar_incidents = [{"id": str(historical_corpus.iloc[idx]['id']), "event_cause": str(historical_corpus.iloc[idx]['event_cause']), "priority": str(historical_corpus.iloc[idx]['priority']), "requires_road_closure": str(historical_corpus.iloc[idx]['requires_road_closure']), "resolution_minutes": float(historical_corpus.iloc[idx]['resolution_minutes']), "similarity": f"{d*100:.1f}%"} for d, idx in zip(distances[0], indices[0]) if idx < len(historical_corpus)]

    # 6. Model Consensus / Agreement
    faiss_prio = "N/A"
    if similar_incidents:
        faiss_prio = max(set([inc['priority'] for inc in similar_incidents]), key=[inc['priority'] for inc in similar_incidents].count)
    
    agreement_score = 1 # The ML Model itself is Source #1
    if prio == faiss_prio: agreement_score += 1 # FAISS is Source #2
    if (prio in ["High", "Critical"] and risk_label in ["High", "Medium"]) or (prio in ["Low", "Medium"] and risk_label == "Low"): agreement_score += 1 # Spatial Risk is Source #3
    
    agreement_pct = round((agreement_score / 3) * 100)
    
    model_agreement = {
        "model_prio": {"val": prio, "match": prio == faiss_prio},
        "faiss_prio": {"val": faiss_prio, "match": prio == faiss_prio},
        "spatial_risk": {"val": risk_label, "match": (prio in ["Low", "Medium"] and risk_label == "Low") or (prio in ["High", "Critical"] and risk_label in ["High", "Medium"])},
        "score": agreement_score,
        "score_pct": agreement_pct,
        "confidence": "STRONG" if agreement_score == 3 else "MODERATE" if agreement_score == 2 else "WEAK"
    }

    # 7. Recommendations & Cost Estimation
    recommendations = []
    base_officers = 2
    prio_w = {"Low": 0, "Medium": 1, "High": 3, "Critical": 6}.get(prio, 0)
    close_w = 3 if closure == "TRUE" else 0
    den_w = 2 if dist_band == "Hotspot" else 1 if dist_band == "Near" else 0
    officers = base_officers + prio_w + close_w + den_w

    cost_details = [{"item": f"Traffic Officers ({officers})", "cost": officers * 1200}]
    
    if "accident" in cause_lower or "collision" in cause_lower:
        recommendations.append("Dispatch ambulance and police investigation unit.")
        cost_details.append({"item": "EMS & Police Response", "cost": 6000})
    if "breakdown" in cause_lower: 
        recommendations.append("Dispatch municipal heavy towing unit.")
        cost_details.append({"item": "Heavy Tow Unit", "cost": 3500})
    elif "tree" in cause_lower: 
        recommendations.append("Dispatch municipal tree removal and chainsaw crew.")
        cost_details.append({"item": "Tree Removal Crew", "cost": 5000})
    elif "water" in cause_lower or "flood" in cause_lower or "submerged" in desc: 
        recommendations.append("Deploy municipal water drainage pumps.")
        cost_details.append({"item": "Drainage Pumps", "cost": 4000})
    
    if closure == "TRUE": recommendations.append("Enforce traffic restriction and activate regional VMS signs.")
    if dist_band in ["Hotspot", "Near"]: recommendations.append("Issue immediate commuter advisory via localized channels.")
    recommendations.append(f"Deploy {officers} traffic officers based on density assessment.")

    total_cost = sum(item['cost'] for item in cost_details)

    # 8. What-If Scenario Simulator
    what_if = None
    if closure == "FALSE":
        new_sev = max(30, round((0.35 * prio_score) + (0.30 * 100) + (0.20 * hotspot_score) + (0.15 * density_score)))
        new_off = officers + 3
        new_cost = total_cost + (3 * 1200)
        what_if = {"trigger": "Traffic Restriction Required", "sev_old": operational_severity, "sev_new": new_sev, "cost_old": f"₹{total_cost:,}", "cost_new": f"₹{new_cost:,}"}
    elif prio in ["Low", "Medium"]:
        new_prio_score = 80 # High
        new_sev = max(30, round((0.35 * new_prio_score) + (0.30 * close_score) + (0.20 * hotspot_score) + (0.15 * density_score)))
        new_off = officers + (3 if prio == "Medium" else 4)
        new_cost = total_cost + ((new_off - officers) * 1200)
        what_if = {"trigger": "Priority Escalates to High", "sev_old": operational_severity, "sev_new": new_sev, "cost_old": f"₹{total_cost:,}", "cost_new": f"₹{new_cost:,}"}

    # 9. Timeline Generation
    t_rep = now.strftime("%H:%M")
    t_disp = (now + timedelta(minutes=5)).strftime("%H:%M")
    t_arr = (now + timedelta(minutes=15)).strftime("%H:%M")
    t_clr = (now + timedelta(minutes=res_time)).strftime("%H:%M")
    timeline = [
        {"time": t_rep, "event": "Incident Logged"},
        {"time": t_disp, "event": "Units Dispatched"},
        {"time": t_arr, "event": "Arrival on Scene"},
        {"time": t_clr, "event": "Expected Clearance"}
    ]

    faiss_consensus = "No analogues found."
    avg_sim_res = 0
    if similar_incidents:
        avg_sim_res = int(np.mean([inc['resolution_minutes'] for inc in similar_incidents]))
        no_close = sum(1 for inc in similar_incidents if inc['requires_road_closure'] == "FALSE")
        prio_list = [inc['priority'] for inc in similar_incidents]
        faiss_consensus = f"Restriction Consensus: {no_close}/{len(similar_incidents)} NO | Avg Res: {avg_sim_res}m | Prio: {', '.join([f'{prio_list.count(p)} {p}' for p in set(prio_list)])}"

    has_anomaly = False
    if similar_incidents and avg_sim_res > 0:
        if avg_sim_res > (res_time * 3) or res_time > (avg_sim_res * 3):
            model_warnings.append(f"Model predicts {res_time} mins, but historical analogues averaged {avg_sim_res} mins. Analyst review recommended.")
            has_anomaly = True

    return {
        "priority": prio, "priority_conf": prio_conf,
        "closure": closure, "closure_conf": close_conf,
        "override_applied": override_applied,
        "resolution_hours": res_hours, "resolution_mins": res_mins,
        "operational_severity": operational_severity, "severity_components": sev_components, "severity_band": sev_band,
        "spatial_risk": {"band": dist_band, "nearby_m": nearest_hotspot_m, "cluster": cluster_id, "lat": hs_lat, "lon": hs_lon},
        "shap": top_shap, "narrative_reasons": narrative_reasons,
        "recommendations": recommendations, "similar": similar_incidents,
        "faiss_consensus": faiss_consensus, "model_warnings": model_warnings, "has_anomaly": has_anomaly,
        "cost_details": cost_details, "total_cost": f"₹{total_cost:,}", "timeline": timeline,
        "model_agreement": model_agreement, "what_if": what_if
    }