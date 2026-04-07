import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, onSnapshot, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyDgoYgl3vm_gwcsc3SPkQRtfFhJSpoviYg",
    authDomain: "communitypulseapp.firebaseapp.com",
    projectId: "communitypulseapp",
    storageBucket: "communitypulseapp.firebasestorage.app",
    messagingSenderId: "632519849798",
    appId: "1:632519849798:web:25533597d06763405e1747",
    measurementId: "G-GZ4ENN87WJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ========== GEMINI AI CONFIGURATION ==========
// Get your free API key from: https://makersuite.google.com/app/apikey
const GEMINI_API_KEY = "AIzaSyAY639IR1X6nGFPjIB7hcWGzTJi6PpzUak"; // Replace with your actual API key
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

// AI Helper Functions
async function callGeminiAPI(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
        console.warn("⚠️ Please add your Gemini API key to use AI features");
        return null;
    }
    
    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500,
                }
            })
        });
        
        const data = await response.json();
        if (data.candidates && data.candidates[0]) {
            return data.candidates[0].content.parts[0].text;
        }
        return null;
    } catch (error) {
        console.error("Gemini API Error:", error);
        return null;
    }
}

// AI: Analyze need description and return category, urgency, and suggested skills
async function analyzeNeedWithAI(description, city, state) {
    const prompt = `You are an AI assistant for a crisis response platform called CommunityPulse. Analyze this need and return a JSON object with the following fields:
    
    Need description: "${description}"
    Location: ${city}, ${state}
    
    Return ONLY a valid JSON object (no other text) with:
    {
        "category": "one of: food, water, medical, shelter, transportation, supplies, other",
        "urgency": "one of: high, medium, low",
        "urgency_reason": "brief explanation why",
        "suggested_skills": ["skill1", "skill2", "skill3"],
        "estimated_volunteers_needed": number (1-10),
        "safety_tips": "brief safety advice"
    }`;
    
    const result = await callGeminiAPI(prompt);
    if (result) {
        try {
            // Extract JSON from response
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error("Error parsing AI response:", e);
        }
    }
    return null;
}

// AI: Generate response message for volunteers
async function generateVolunteerResponse(needType, urgency, volunteerName) {
    const prompt = `Generate a warm, professional volunteer response message for CommunityPulse.
    
    Need: ${needType}
    Urgency: ${urgency}
    Volunteer Name: ${volunteerName}
    
    Return a short, encouraging message (2-3 sentences) that the volunteer can send to the person in need.`;
    
    return await callGeminiAPI(prompt);
}

// AI: Suggest matching volunteers for a specific need
async function findMatchingVolunteers(needType, needCategory, availableVolunteers) {
    const volunteerList = availableVolunteers.map(v => `${v.name}: ${v.skill}`).join("\n");
    
    const prompt = `You are matching volunteers to a crisis need.
    
    Need: ${needType}
    Category: ${needCategory}
    
    Available Volunteers:
    ${volunteerList}
    
    Return a JSON array of the TOP 3 most suitable volunteer names (only names) based on their skills matching the need.
    Example: ["John Doe", "Jane Smith"]`;
    
    const result = await callGeminiAPI(prompt);
    if (result) {
        try {
            const jsonMatch = result.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error("Error parsing volunteer matches:", e);
        }
    }
    return [];
}

// AI: Summarize active needs for dashboard
async function generateNeedsSummary(needs) {
    if (needs.length === 0) return "No active needs at the moment.";
    
    const needsText = needs.slice(0, 10).map(n => `${n.type} (${n.urgency}) in ${n.city}`).join("\n");
    
    const prompt = `Summarize these crisis needs for a dashboard header (1 sentence):
    
    ${needsText}
    
    Keep it brief and urgent-sounding.`;
    
    return await callGeminiAPI(prompt);
}

// ========== EXISTING NOTIFICATION SYSTEM ==========
let previousNeedsCount = 0;
let notificationPermissionGranted = false;
let lastNeedIds = new Set();

function requestNotificationPermission() {
    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            notificationPermissionGranted = permission === "granted";
            if (notificationPermissionGranted) {
                console.log("📢 Notifications enabled!");
            }
        });
    }
}

function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 1);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        audioContext.resume();
    } catch(e) {
        console.log("Sound not supported");
    }
}

function showBrowserNotification(title, body, needData = null) {
    if (!notificationPermissionGranted) return;
    
    const notification = new Notification(title, {
        body: body,
        icon: "https://cdn-icons-png.flaticon.com/512/5610/5610944.png",
        vibrate: [200, 100, 200]
    });
    
    notification.onclick = function() {
        window.focus();
        if (needData && needData.lat && needData.lng) {
            map.setView([needData.lat, needData.lng], 12);
            showToast(`📍 Need: ${needData.type} in ${needData.city}`, 'info');
        }
    };
}

// ========== MAP SETUP ==========
const map = L.map('map').setView([22.9734, 78.6569], 5);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> & CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

L.control.scale({ metric: true, imperial: false }).addTo(map);

const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    position: 'topleft',
    placeholder: '🔍 Search any location...',
    errorMessage: 'Location not found'
}).on('markgeocode', function(e) {
    const bbox = e.geocode.bbox;
    const center = e.geocode.center;
    map.fitBounds(bbox);
    showToast(`📍 Location found: ${e.geocode.name}`, 'info');
    L.popup().setLatLng(center).setContent(`<b>📍 ${e.geocode.name}</b>`).openOn(map);
}).addTo(map);

let currentMarkers = [];

function clearMarkers() {
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// AI-Enhanced render needs
function renderNeeds(needsArray) {
    clearMarkers();

    needsArray.forEach(need => {
        if (!need.lat || !need.lng) return;
        if (need.status === 'resolved') return;

        let markerColor = '#48bb78';
        if (need.urgency === 'high') markerColor = '#e53e3e';
        else if (need.urgency === 'medium') markerColor = '#ed8936';

        let iconHtml = '<i class="fas fa-hands-helping" style="color: white; font-size: 14px;"></i>';
        if (need.status === 'assigned') {
            iconHtml = '<i class="fas fa-check-circle" style="color: white; font-size: 14px;"></i>';
        }

        const markerHtmlStyles = `
            background-color: ${markerColor};
            width: 2rem;
            height: 2rem;
            display: block;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            ${need.urgency === 'high' && need.status !== 'assigned' ? 'animation: pulse 1.5s infinite;' : ''}
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="${markerHtmlStyles}">${iconHtml}</div>`,
            iconSize: [32, 32],
            popupAnchor: [0, -16]
        });

        const marker = L.marker([need.lat, need.lng], { icon: icon }).addTo(map);

        const urgencyBadge = need.urgency === 'high' ?
            '<span class="badge-high">🔴 CRITICAL</span>' :
            (need.urgency === 'medium' ? '<span class="badge-medium">🟠 MEDIUM</span>' : '<span class="badge-low">🟢 LOW</span>');

        const statusBadge = need.status === 'assigned' ?
            '<span class="badge-assigned">✅ ASSIGNED</span>' :
            '<span class="badge-open">🆓 OPEN</span>';

        // Show AI-suggested skills if available
        const aiSuggestions = need.ai_suggested_skills ? 
            `<div style="font-size:0.7rem; margin-top:5px; color:#2c7be5;">
                <i class="fas fa-robot"></i> AI suggests: ${need.ai_suggested_skills.slice(0, 2).join(', ')}
            </div>` : '';

        let actionButtons = '';

        if (need.status === 'assigned') {
            actionButtons = `
                <button id="completeBtn_${need.id}" style="background:#48bb78; border:none; color:white; border-radius:30px; padding:6px 16px; font-size:0.75rem; margin-top:5px; cursor:pointer; width:100%; font-weight:600;">
                  ✓ Mark as Completed
                </button>
            `;
        } else {
            actionButtons = `
                <button id="volunteerBtn_${need.id}" style="background:#2c7be5; border:none; color:white; border-radius:30px; padding:6px 16px; font-size:0.75rem; margin-top:5px; cursor:pointer; width:100%; font-weight:600;">
                  🙋 I Can Help (AI Recommended)
                </button>
                <button id="resolveBtn_${need.id}" style="background:#718096; border:none; color:white; border-radius:30px; padding:6px 16px; font-size:0.75rem; margin-top:5px; cursor:pointer; width:100%; font-weight:600;">
                  ✓ Mark Resolved
                </button>
            `;
        }

        const popupContent = `
            <div style="min-width: 240px; font-family: 'Inter', sans-serif;">
                <strong style="font-size:1.1rem; color: #1a2c3e;">🆘 ${escapeHtml(need.type)}</strong>
                ${need.ai_category ? `<span style="font-size:0.65rem; background:#e2e8f0; padding:2px 6px; border-radius:12px; margin-left:5px;">🤖 ${need.ai_category}</span>` : ''}
                <br>
                <i class="fas fa-map-marker-alt" style="color: #2c7be5;"></i> ${escapeHtml(need.city)}, ${escapeHtml(need.state)}<br>
                ⚡ Urgency: ${urgencyBadge}<br>
                📌 Status: ${statusBadge}<br>
                ${need.volunteerName ? `<i class="fas fa-user-check"></i> Volunteer: ${escapeHtml(need.volunteerName)}<br>` : ''}
                ${need.ai_safety_tips ? `<i class="fas fa-shield-alt"></i> <span style="font-size:0.7rem;">${escapeHtml(need.ai_safety_tips)}</span><br>` : ''}
                ${aiSuggestions}
                <hr style="margin:8px 0">
                ${actionButtons}
            </div>
        `;

        marker.bindPopup(popupContent);

        marker.on('popupopen', () => {
            setTimeout(() => {
                const volunteerBtn = document.getElementById(`volunteerBtn_${need.id}`);
                if (volunteerBtn) {
                    volunteerBtn.onclick = async () => {
                        const volunteerName = prompt("Enter your name to help with this need:");
                        if (!volunteerName) return;

                        const volunteerContact = prompt("Enter your phone number (optional):");
                        
                        // Generate AI response message
                        showToast("🤖 AI is generating a response message...", 'info');
                        const aiMessage = await generateVolunteerResponse(need.type, need.urgency, volunteerName);
                        
                        if (confirm(`Confirm: ${volunteerName} will help with "${need.type}"?\n\n🤖 AI Suggests saying:\n"${aiMessage || 'I am here to help!'}"`)) {
                            try {
                                await updateDoc(doc(db, "needs", need.id), {
                                    status: 'assigned',
                                    volunteerName: volunteerName,
                                    volunteerContact: volunteerContact || 'Not provided',
                                    ai_response_message: aiMessage,
                                    assignedAt: new Date().toISOString()
                                });
                                map.closePopup();
                                showToast(`🙏 Thank you ${volunteerName}! AI response saved!`, 'success');
                            } catch (e) {
                                console.error(e);
                                showToast('Error volunteering. Please try again.', 'error');
                            }
                        }
                    };
                }

                const completeBtn = document.getElementById(`completeBtn_${need.id}`);
                if (completeBtn) {
                    completeBtn.onclick = async () => {
                        if (confirm("Has this need been successfully fulfilled?")) {
                            try {
                                await updateDoc(doc(db, "needs", need.id), {
                                    status: 'resolved',
                                    completedAt: new Date().toISOString()
                                });
                                map.closePopup();
                                showToast('🎉 Need marked as completed! Great job!', 'success');
                            } catch (e) {
                                console.error(e);
                                showToast('Error completing need', 'error');
                            }
                        }
                    };
                }

                const resolveBtn = document.getElementById(`resolveBtn_${need.id}`);
                if (resolveBtn) {
                    resolveBtn.onclick = async () => {
                        if (confirm("Mark this need as resolved? It will be removed from the map.")) {
                            try {
                                await updateDoc(doc(db, "needs", need.id), {
                                    status: 'resolved',
                                    resolvedAt: new Date().toISOString()
                                });
                                map.closePopup();
                                showToast('Need marked as resolved! 🎉', 'success');
                            } catch (e) {
                                console.error(e);
                                showToast('Error resolving need', 'error');
                            }
                        }
                    };
                }
            }, 100);
        });

        currentMarkers.push(marker);
    });
}

function updateStats(needsCount, volsCount) {
    document.getElementById('needCount').innerText = needsCount;
    document.getElementById('volCount').innerText = volsCount;
}

function updateVolunteerUI(volunteers) {
    const container = document.getElementById('volunteerListContainer');
    if (!container) return;
    
    if (volunteers.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#718096;"><i class="fas fa-users"></i> ✨ No volunteers yet — be the first to help!</div>';
        return;
    }
    
    let html = '';
    volunteers.forEach(vol => {
        html += `
            <div class="vol-item" onclick="contactVolunteer('${escapeHtml(vol.name)}', '${escapeHtml(vol.skill)}', '${escapeHtml(vol.phone || 'No phone')}')">
                <i class="fas fa-user-circle"></i>
                <div class="vol-info">
                    <strong>${escapeHtml(vol.name)} 🟢</strong>
                    <span><i class="fas fa-tools"></i> ${escapeHtml(vol.skill)}</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.contactVolunteer = function(name, skill, phone) {
    alert(`📞 Contact Volunteer: ${name}\n📋 Skills: ${skill}\n📱 Phone: ${phone}\n\nIn a real app, this would connect you directly!`);
    showToast(`📱 ${name} has been notified of your interest!`, 'info');
};

// AI-Enhanced check for new needs
async function checkAndNotifyNewNeeds(currentNeeds) {
    const currentNeedIds = new Set(currentNeeds.map(n => n.id));
    const newNeeds = currentNeeds.filter(n => !lastNeedIds.has(n.id));
    
    if (newNeeds.length > 0) {
        playNotificationSound();
        
        for (const need of newNeeds) {
            const urgencyEmoji = need.urgency === 'high' ? '🔴 CRITICAL' : (need.urgency === 'medium' ? '🟠 MEDIUM' : '🟢 LOW');
            
            // AI: Generate smart notification message
            const aiNotificationMsg = await generateVolunteerResponse(need.type, need.urgency, "Volunteer");
            const notificationBody = aiNotificationMsg || `${need.type} needed in ${need.city}, ${need.state}`;
            
            showBrowserNotification(
                `🚨 New ${urgencyEmoji} Need!`,
                notificationBody,
                need
            );
            
            showToast(`📢 NEW: ${need.type} in ${need.city} (${urgencyEmoji})`, 'info');
        }
    }
    
    lastNeedIds = currentNeedIds;
}

let volunteersUnsubscribe;
function initVolunteersRealtime() {
    const volCol = collection(db, "volunteers");
    volunteersUnsubscribe = onSnapshot(volCol, (snapshot) => {
        const volList = [];
        snapshot.forEach(docSnap => {
            volList.push({ id: docSnap.id, ...docSnap.data() });
        });
        updateVolunteerUI(volList);
    }, (error) => {
        console.error("Volunteer snapshot error:", error);
    });
}

let needsUnsubscribe;
function initNeedsRealtime() {
    const needsCol = collection(db, "needs");
    needsUnsubscribe = onSnapshot(needsCol, async (snapshot) => {
        const needsArray = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            needsArray.push({ id: docSnap.id, ...data });
        });
        
        const activeNeeds = needsArray.filter(n => n.status !== 'resolved');
        renderNeeds(activeNeeds);
        await checkAndNotifyNewNeeds(activeNeeds);
        
        // AI: Update dashboard summary
        if (activeNeeds.length > 0) {
            const summary = await generateNeedsSummary(activeNeeds);
            const summaryElement = document.getElementById('aiSummary');
            if (summaryElement && summary) {
                summaryElement.innerHTML = `<i class="fas fa-robot"></i> 🤖 AI: ${summary}`;
            }
        }
        
        const volSnapshot = await getDocs(collection(db, "volunteers"));
        updateStats(activeNeeds.length, volSnapshot.size);
    }, (error) => {
        console.error("Needs snapshot error:", error);
    });
}

// AI-Enhanced Add Need Function
window.addNeed = async function (event) {
    const type = document.getElementById("type").value.trim();
    const city = document.getElementById("city").value.trim();
    const state = document.getElementById("state").value.trim();
    const urgency = document.getElementById("urgency").value;
    const requesterName = document.getElementById("requesterName")?.value.trim() || "Anonymous";
    const requesterPhone = document.getElementById("requesterPhone")?.value.trim() || "";

    if (!type || !city || !state) {
        showToast('❌ Please fill Type, City, and State!', 'error');
        return;
    }

    const addBtn = event?.target;
    const originalText = addBtn?.innerHTML;
    if (addBtn) addBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> AI Analyzing...';

    try {
        // AI Analysis of the need
        showToast("🤖 AI is analyzing the need...", 'info');
        const aiAnalysis = await analyzeNeedWithAI(type, city, state);
        
        if (aiAnalysis) {
            console.log("AI Analysis:", aiAnalysis);
            showToast(`🤖 AI suggests: ${aiAnalysis.category} need, ${aiAnalysis.urgency} urgency`, 'info');
        }

        const query = `${city}, ${state}, India`;
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
            { headers: { "User-Agent": "community-pulse-app-v2" } }
        );
        const data = await response.json();

        if (!data || data.length === 0) {
            showToast('📍 Location not found! Try a different city or district.', 'error');
            if (addBtn) addBtn.innerHTML = originalText;
            return;
        }

        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        // Save need with AI analysis data
        await addDoc(collection(db, "needs"), {
            type,
            city,
            state,
            lat,
            lng,
            urgency: aiAnalysis?.urgency || urgency,
            status: 'open',
            requesterName: requesterName,
            requesterPhone: requesterPhone,
            ai_category: aiAnalysis?.category || null,
            ai_suggested_skills: aiAnalysis?.suggested_skills || [],
            ai_safety_tips: aiAnalysis?.safety_tips || null,
            ai_volunteers_needed: aiAnalysis?.estimated_volunteers_needed || 1,
            timestamp: new Date().toISOString()
        });

        showToast('✅ Need published successfully! AI has optimized it for volunteers!', 'success');
        
        // Clear form
        document.getElementById("type").value = "";
        document.getElementById("city").value = "";
        document.getElementById("state").value = "";
        if (document.getElementById("requesterName")) {
            document.getElementById("requesterName").value = "";
        }
        if (document.getElementById("requesterPhone")) {
            document.getElementById("requesterPhone").value = "";
        }

        if (addBtn) addBtn.innerHTML = originalText;
    } catch (error) {
        console.error(error);
        showToast('⚠️ Network error adding need. Please try again.', 'error');
        if (addBtn) addBtn.innerHTML = originalText;
    }
};

window.addVolunteer = async function (event) {
    const name = document.getElementById("vname").value.trim();
    const skill = document.getElementById("vskill").value.trim();
    const phone = document.getElementById("vphone")?.value.trim() || "";
    const location = document.getElementById("vlocation")?.value.trim() || "";

    if (!name || !skill) {
        showToast('❌ Please enter your name and skills!', 'error');
        return;
    }

    const volBtn = event?.target;
    const originalText = volBtn?.innerHTML;
    if (volBtn) volBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Registering...';

    try {
        await addDoc(collection(db, "volunteers"), {
            name,
            skill,
            phone: phone,
            location: location,
            available: true,
            registeredAt: new Date().toISOString()
        });

        showToast('🎉 Thank you! AI will match you with relevant needs!', 'success');
        
        document.getElementById("vname").value = "";
        document.getElementById("vskill").value = "";
        if (document.getElementById("vphone")) {
            document.getElementById("vphone").value = "";
        }
        if (document.getElementById("vlocation")) {
            document.getElementById("vlocation").value = "";
        }

        if (volBtn) volBtn.innerHTML = originalText;
        requestNotificationPermission();
        
    } catch (err) {
        console.error("Error adding volunteer:", err);
        showToast('⚠️ Error registering volunteer. Please try again.', 'error');
        if (volBtn) volBtn.innerHTML = originalText;
    }
};

// Initialize
requestNotificationPermission();
initNeedsRealtime();
initVolunteersRealtime();

setTimeout(() => {
    map.setView([22.9734, 78.6569], 5);
    showToast('🌍 CommunityPulse with AI is live! 🤖 Gemini AI is ready to help!', 'info');
}, 500);

window.addEventListener('beforeunload', () => {
    if (needsUnsubscribe) needsUnsubscribe();
    if (volunteersUnsubscribe) volunteersUnsubscribe();
});

console.log("🔥 CommunityPulse with Google Gemini AI - Smart Crisis Response!");