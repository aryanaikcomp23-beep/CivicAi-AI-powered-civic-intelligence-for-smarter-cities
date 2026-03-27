CivicAI
# 🌆 AI-Powered Civic Intelligence for Smarter Cities

An end-to-end web platform that enables citizens to report civic issues (potholes, garbage, water leakage, drainage blockage, etc.) and uses **AI + Geospatial Intelligence** to help city municipalities prioritize, cluster, resolve, and predict urban problems.

The system automates reporting → deduplication → prioritization → worker assignment → hotspot prediction → auto-escalation → verification.

---

## ✅ Key Features

### **1. Smart Issue Reporting**
- Citizens upload photos of civic problems.
- System auto-captures:
  - GPS coordinates
  - Timestamp
- Issues stored instantly in MongoDB Atlas.

---

### **2. AI-Based Image & Location Clustering (Duplicate Detection)**
- Vision model identifies issue type: pothole / garbage / crack.
- Geo-clustering groups reports within a radius.
- AI checks if the same issue was previously reported.
- Prevents duplicate tickets and reduces workload.

---

### **3. Priority Scoring Engine**
Each issue receives a **priority score** based on:
- Severity detected by computer vision  
- Number of complaints in same cluster  
- Location sensitivity (school / hospital / main road)  
- Historical recurrence  

Priority Levels: **High / Medium / Low**

---

### **4. Task Assignment to Municipal Workers**
System automatically assigns issues to:
- Sanitation team  
- Road repair team  
- Water/drainage team  

Workers receive:
- Issue photo  
- Geo-location  
- Severity & SLA deadline  

---

### **5. Hotspot Prediction (AI Forecasting)**
AI analyzes:
- Past complaints  
- Weather data  
- Recurrence patterns  

Predicts:
- Future pothole zones  
- Garbage overflow areas  
- Flood-prone drainage spots  

Heatmaps shown on dashboard.

---

### **6. Automatic Escalation Engine**
Tracks SLA deadlines:
- **Level 1:** Local Officer
- **Level 2:** Senior Zonal Officer
- **Level 3:** City Commissioner

Ensures accountability & transparency.

---

### **7. Verification & Citizen Feedback**
- Worker uploads after-repair photo.
- AI performs *before vs after* validation.
- Citizen receives notification to verify & rate.

---

### **8. Authority Dashboard**
Real-time analytics:
- Live city issue map
- Clusters & hotspots
- Department performance
- Average closure times
- High-risk areas

---

## 🗂️ Tech Stack

### **Frontend**
- HTML, CSS, JavaScript  
- Leaflet.js / Mapbox (Maps)
- TensorFlow.js (On-device AI)

### **Backend**
- Node.js / Express _(optional)_
- MongoDB Atlas **Data API** (No backend required)

### **AI Models**
- Image classification (pothole/garbage/crack)
- Severity estimation model
- Geo-clustering (Haversine formula + DBSCAN)
- LSTM / regression model for hotspot prediction

---

## 📦 Project Structure
