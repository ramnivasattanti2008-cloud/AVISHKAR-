/**
 * UrjaSetu (ऊर्जासेतु) - Next-Gen Executive National Infrastructure Controller
 * Dual-Theme Engine (Executive Alabaster Light & Obsidian Night Mission Control)
 * 21st.dev Component Interactions (Spotlight Cards, Celestial Sun/Moon Toggle, 24H Auto-Simulator)
 * Real-Time Telemetry • Solar Arc Animation • Sankey Power Flow
 * HiGHS 24H Spline Chart • PM Surya Ghar Calculator • Bilingual EN/HI
 */

// ============================================================================
// COMPREHENSIVE REGIONAL MICROGRID DATABASE
// ============================================================================
const REGIONAL_HUBS = {
  mathura: {
    name: "Sharma Niwas (Family Residence)",
    location: "Krishna Nagar, Mathura • 3-BHK Villa",
    state: "Uttar Pradesh (DVVNL / UPPCL)",
    kwp: 3.0, demandKw: 1.8, batteryKwh: 5.0,
    sanctionedLoad: "3.0 kW",
    monthlySavings: "₹1,294", oldBill: "₹2,228", newBill: "₹935",
    dailySavings: "₹43.10",
    satellite: "INSAT-3D (82°E Slot)", zone: "Northern Plains (77°E)",
    insolation: 5.1, tariffPeak: 9.40, tariffNormal: 7.20,
    cloudBase: 72, outageRisk: 0.85, outageReserve: 35,
    appliances: { lights: "36h", fans: "24h", fridge: "14h", wifi: "48h" }
  },
  jaipur: {
    name: "Dr. Verma Care Clinic & Dialysis",
    location: "Malviya Nagar, Jaipur • Healthcare Clinic",
    state: "Rajasthan (JVVNL)",
    kwp: 30.0, demandKw: 18.0, batteryKwh: 40.0,
    sanctionedLoad: "25.0 kW",
    monthlySavings: "₹14,850", oldBill: "₹28,400", newBill: "₹13,550",
    dailySavings: "₹495.00",
    satellite: "INSAT-3DR / 3DS (74°E)", zone: "Thar Solar Belt (75°E)",
    insolation: 5.9, tariffPeak: 11.80, tariffNormal: 8.90,
    cloudBase: 12, outageRisk: 0.25, outageReserve: 45,
    appliances: { lights: "72h", fans: "48h", fridge: "36h", wifi: "96h" }
  },
  pune: {
    name: "Kulkarni Supermarket & Cold Storage",
    location: "Kothrud, Pune • Commercial Retail",
    state: "Maharashtra (MSEDCL)",
    kwp: 15.0, demandKw: 8.5, batteryKwh: 20.0,
    sanctionedLoad: "15.0 kW",
    monthlySavings: "₹8,420", oldBill: "₹18,250", newBill: "₹9,830",
    dailySavings: "₹280.60",
    satellite: "INSAT-3DR (74°E Slot)", zone: "Western India (73°E)",
    insolation: 5.4, tariffPeak: 12.50, tariffNormal: 9.80,
    cloudBase: 18, outageRisk: 0.15, outageReserve: 25,
    appliances: { lights: "48h", fans: "32h", fridge: "20h", wifi: "60h" }
  },
  bengaluru: {
    name: "Bengaluru Smart Grid", state: "Karnataka (BESCOM)",
    kwp: 25.0, demandKw: 14.0, batteryKwh: 35.0,
    sanctionedLoad: "20.0 kW",
    monthlySavings: "₹12,400", oldBill: "₹24,200", newBill: "₹11,800",
    dailySavings: "₹413.30",
    satellite: "INSAT-3D / 3DS (82°E)", zone: "Deccan South (77°E)",
    insolation: 5.2, tariffPeak: 10.90, tariffNormal: 8.40,
    cloudBase: 25, outageRisk: 0.30, outageReserve: 30,
    appliances: { lights: "60h", fans: "40h", fridge: "28h", wifi: "72h" }
  },
  delhi: {
    name: "Delhi NCR Solar Cluster", state: "Delhi (BRPL / BYPL)",
    kwp: 50.0, demandKw: 32.0, batteryKwh: 60.0,
    sanctionedLoad: "40.0 kW",
    monthlySavings: "₹24,500", oldBill: "₹48,900", newBill: "₹24,400",
    dailySavings: "₹816.60",
    satellite: "INSAT-3D (82°E Slot)", zone: "Northern Ridge (77°E)",
    insolation: 4.9, tariffPeak: 12.00, tariffNormal: 9.10,
    cloudBase: 35, outageRisk: 0.20, outageReserve: 20,
    appliances: { lights: "96h", fans: "64h", fridge: "48h", wifi: "120h" }
  },
  ahmedabad: {
    name: "Ahmedabad Solar City", state: "Gujarat (Torrent Power)",
    kwp: 40.0, demandKw: 22.0, batteryKwh: 50.0,
    sanctionedLoad: "30.0 kW",
    monthlySavings: "₹19,200", oldBill: "₹38,000", newBill: "₹18,800",
    dailySavings: "₹640.00",
    satellite: "INSAT-3DR (74°E Slot)", zone: "Saurashtra (72°E)",
    insolation: 5.6, tariffPeak: 11.20, tariffNormal: 8.60,
    cloudBase: 15, outageRisk: 0.18, outageReserve: 20,
    appliances: { lights: "80h", fans: "50h", fridge: "36h", wifi: "100h" }
  }
};

// ============================================================================
// BILINGUAL TRANSLATIONS (PRISTINE UTF-8 DEVANAGARI & ENGLISH)
// ============================================================================
const I18N = {
  en: {
    brand_tagline: "National Clean Energy Grid",
    nav_radar: "Radar & Flow",
    nav_dispatch: "24H Dispatch",
    nav_subsidy: "PM Surya Ghar",
    nav_tariffs: "Tariffs & Ledger",
    nav_citations: "Citations",
    header_sat_sync: "🛰️ INSAT-3DR Synced",
    btn_streamlit: "Console",
    hero_pill: "ISRO INSAT-3DR Geostationary Nowcasting • Beckn DEG v2.0 Protocol",
    hero_h1: "India's Next-Gen Predictive Energy Management & Surplus Dispatch",
    hero_sub: "AI-driven 15-minute dispatch horizons, dynamic blackout reserve floor, and decentralized peer-to-peer clean energy trading for Indian rooftop solar & microgrids.",
    scroll_explore: "Scroll to Explore",
    sc_pune_city: "Pune Commercial Hub",
    sc_pune_title: "P2P Surplus Market",
    sc_pune_desc: "Sunny surplus commercial day with active Beckn DEG trades and peer-to-peer export.",
    sc_mathura_city: "Mathura Rural Microgrid",
    sc_mathura_title: "CEEW Outage Shield",
    sc_mathura_desc: "Monsoon blackout resilience with dynamic emergency reserve floor based on measured feeder outages.",
    sc_jaipur_city: "Jaipur Healthcare Clinic",
    sc_jaipur_title: "EV V2H & Feeder Guard",
    sc_jaipur_desc: "Evening peak V2H bidirectional discharge and distribution transformer thermal overload guard.",
    lbl_dni: "Direct Solar Beam (DNI) • W/m²",
    lbl_gen: "Active Solar Generation • kW",
    lbl_co2: "Daily Avoided Emissions • kg CO₂",
    lbl_latency: "Anti-Islanding Trip Latency (< 2.0s)",
    bento_tag: "Decentralized Energy Grid (DEG)",
    bento_h2: "Microgrid Telemetry & Citizen Intelligence",
    bento_sub: "High-density mission control tiles integrating geostationary satellite telemetry, live Sankey microgrid flows, citizen savings shields, and open P2P orderbooks.",
    tile_sat_title: "ISRO / NavIC Satellite Feeds",
    tile_sat_sub: "Geostationary meteorological synthesis & NavIC regional coordinates",
    lbl_direct_beam: "Direct Beam (DNI)",
    lbl_tilted_irr: "Tilted Irradiance",
    lbl_cloud: "Cloud Opacity",
    lbl_clearness: "Clearness (kt)",
    tile_balance_title: "Live Microgrid Balance",
    tile_balance_sub: "Real-Time Power Flow with animated directional wattage",
    tile_citizen_title: "Aam Aadmi / Citizen Guide",
    tile_citizen_sub: "Bijli Bachat & Outage Shield (बिजली बचत एवं आउटेज शील्ड)",
    lbl_direct_savings: "Direct Daily Savings",
    lbl_saved_discom: "⚡ Saved vs Standard DISCOM Peak Tariff",
    lbl_outage_reserve: "🛡️ Outage Reserve: 35%",
    app_lights: "5 LED Lights",
    app_fans: "2 Ceiling Fans",
    app_fridge: "Inverter Fridge",
    app_pump: "Water Pump",
    btn_whatsapp: "1-Click WhatsApp Power-Cut Alert",
    tile_beckn_title: "Beckn DEG Protocol v2.0",
    tile_beckn_sub: "P2P Decentralized Clean Energy Orderbook (15-min Continuous Auction)",
    dispatch_tag: "Convex LP Solver Engine",
    dispatch_h2: "HiGHS Convex Linear Programming Dispatch",
    dispatch_sub: "24-Hour Predictive Dispatch & Optimization Curve. Click Auto-Simulate to see the linear programming solver re-balance microgrid dispatch in real time across the full day cycle.",
    lbl_soc: "Midnight Battery SoC:",
    lbl_hour: "Simulation Hour:",
    leg_solar: "Solar Generation (kW)",
    leg_load: "Facility Load Profile (kW)",
    leg_p2p: "P2P Export Surplus (kW)",
    leg_hour: "Active Simulation Hour",
    subsidy_h2: "PM Surya Ghar: Muft Bijli Yojana Official Subsidy Calculator",
    subsidy_sub: "Direct Financial Assistance (DBT) calculator grounded in official MNRE guidelines and national portal specifications (pmsuryaghar.gov.in).",
    calc_units_lbl: "Monthly Electricity Consumption",
    calc_units_hint: "Residential slab based on last DISCOM electricity bill",
    calc_cap_lbl: "Proposed Solar Plant Capacity",
    calc_cap_hint: "Requires approx 100 sq.ft shade-free roof per kW",
    calc_dbt_lbl: "Direct Central Subsidy (DBT)",
    calc_net_lbl: "Net Estimated Investment",
    calc_savings_lbl: "Annual Bill Savings",
    btn_apply_portal: "Apply on National Portal (pmsuryaghar.gov.in) ↗",
    citations_tag: "Verifiable Research, Portals & Standards",
    citations_h2: "Official Government Portals & Research Citations",
    citations_sub: "UrjaSetu EMS is grounded in statutory regulations, official meteorological feeds, and open energy network protocols."
  },
  hi: {
    brand_tagline: "राष्ट्रीय स्वच्छ ऊर्जा ग्रिड",
    nav_radar: "राडार एवं प्रवाह",
    nav_dispatch: "24 घंटे प्रेषण",
    nav_subsidy: "पीएम सूर्य घर",
    nav_tariffs: "टैरिफ एवं बहीखाता",
    nav_citations: "प्रमाण पत्र",
    header_sat_sync: "🛰️ INSAT-3DR समन्वित",
    btn_streamlit: "कंसोल",
    hero_pill: "इसरो INSAT-3DR भू-स्थिर पूर्वानुमान • Beckn DEG v2.0 प्रोटोकॉल",
    hero_h1: "भारत का अगली पीढ़ी का भविष्यसूचक ऊर्जा प्रबंधन एवं अधिशेष प्रेषण",
    hero_sub: "एआई-संचालित 15-मिनट प्रेषण, गतिशील ब्लैकआउट रिज़र्व फ्लोर, और भारतीय रूफटॉप सोलर तथा माइक्रोग्रिड के लिए विकेंद्रीकृत पीयर-टू-पीयर स्वच्छ ऊर्जा व्यापार।",
    scroll_explore: "नीचे स्क्रॉल करें",
    sc_pune_city: "पुणे वाणिज्यिक हब",
    sc_pune_title: "P2P अधिशेष बाज़ार",
    sc_pune_desc: "सक्रिय बेकन डीईजी ट्रेडों और पीयर-टू-पीयर निर्यात के साथ उज्ज्वल वाणिज्यिक दिन।",
    sc_mathura_city: "मथुरा ग्रामीण माइक्रोग्रिड",
    sc_mathura_title: "CEEW आउटेज शील्ड",
    sc_mathura_desc: "फीडर आउटेज डेटा पर आधारित गतिशील आपातकालीन रिज़र्व के साथ मानसून ब्लैकआउट सुरक्षा।",
    sc_jaipur_city: "जयपुर स्वास्थ्य केंद्र",
    sc_jaipur_title: "EV V2H एवं फीडर रक्षक",
    sc_jaipur_desc: "शाम के पीक समय में V2H द्विदिश डिस्चार्ज और वितरण ट्रांसफार्मर थर्मल सुरक्षा।",
    lbl_dni: "प्रत्यक्ष सौर किरण (DNI) • W/m²",
    lbl_gen: "सक्रिय सौर उत्पादन • kW",
    lbl_co2: "दैनिक रोके गए उत्सर्जन • kg CO₂",
    lbl_latency: "एंटी-आइसलैंडिंग ट्रिप विलंबता (< 2.0s)",
    bento_tag: "विकेंद्रीकृत ऊर्जा ग्रिड (DEG)",
    bento_h2: "माइक्रोग्रिड टेलीमेट्री एवं नागरिक बुद्धिमत्ता",
    bento_sub: "भू-स्थिर उपग्रह टेलीमेट्री, वास्तविक समय सैंकी प्रवाह, नागरिक बचत शील्ड और खुला पी2पी ऑर्डरबुक।",
    tile_sat_title: "इसरो / NavIC उपग्रह फ़ीड",
    tile_sat_sub: "भू-स्थिर मौसम संबंधी संश्लेषण एवं क्षेत्रीय निर्देशांक",
    lbl_direct_beam: "प्रत्यक्ष किरण (DNI)",
    lbl_tilted_irr: "झुकाव विकिरण",
    lbl_cloud: "बादल की सघनता",
    lbl_clearness: "स्पष्टता सूचकांक (kt)",
    tile_balance_title: "लाइव माइक्रोग्रिड संतुलन",
    tile_balance_sub: "दिशात्मक वाट क्षमता के साथ वास्तविक समय शक्ति प्रवाह",
    tile_citizen_title: "आम नागरिक गाइड",
    tile_citizen_sub: "बिजली बचत एवं आउटेज शील्ड",
    lbl_direct_savings: "प्रत्यक्ष दैनिक बचत",
    lbl_saved_discom: "⚡ डिस्कॉम पीक टैरिफ की तुलना में बचत",
    lbl_outage_reserve: "🛡️ आउटेज रिज़र्व: 35%",
    app_lights: "5 एलईडी लाइटें",
    app_fans: "2 छत के पंखे",
    app_fridge: "इन्वर्टर फ्रिज",
    app_pump: "पानी का पंप",
    btn_whatsapp: "1-क्लिक व्हाट्सएप पावर-कट अलर्ट",
    tile_beckn_title: "Beckn DEG प्रोटोकॉल v2.0",
    tile_beckn_sub: "पी2पी विकेंद्रीकृत स्वच्छ ऊर्जा ऑर्डरबुक (15-मिनट नीलामी)",
    dispatch_tag: "कन्वेक्स एलपी सॉल्वर इंजन",
    dispatch_h2: "HiGHS कन्वेक्स लीनियर प्रोग्रामिंग प्रेषण",
    dispatch_sub: "24-घंटे का पूर्वानुमानात्मक प्रेषण एवं अनुकूलन वक्र। पूर्ण दिन चक्र में वास्तविक समय में ग्रिड प्रेषण को पुनर्संतुलित करने के लिए ऑटो-सिम्युलेट पर क्लिक करें।",
    lbl_soc: "मध्यरात्रि बैटरी स्तर (SoC):",
    lbl_hour: "सिमुलेशन घंटा:",
    leg_solar: "सौर उत्पादन (kW)",
    leg_load: "सुविधा लोड प्रोफाइल (kW)",
    leg_p2p: "P2P निर्यात अधिशेष (kW)",
    leg_hour: "सक्रिय सिमुलेशन घंटा",
    subsidy_h2: "पीएम सूर्य घर: मुफ़्त बिजली योजना आधिकारिक सब्सिडी कैलकुलेटर",
    subsidy_sub: "नवीन एवं नवीकरणीय ऊर्जा मंत्रालय (MNRE) के आधिकारिक दिशा-निर्देशों पर आधारित प्रत्यक्ष लाभ अंतरण (DBT) कैलकुलेटर।",
    calc_units_lbl: "मासिक बिजली खपत",
    calc_units_hint: "अंतिम बिजली बिल पर आधारित आवासीय स्लैब",
    calc_cap_lbl: "प्रस्तावित सोलर प्लांट क्षमता",
    calc_cap_hint: "प्रति किलोवाट लगभग 100 वर्ग फुट छाया-मुक्त छत की आवश्यकता",
    calc_dbt_lbl: "प्रत्यक्ष केंद्रीय सब्सिडी (DBT)",
    calc_net_lbl: "शुद्ध अनुमानित निवेश",
    calc_savings_lbl: "वार्षिक बिल बचत",
    btn_apply_portal: "राष्ट्रीय पोर्टल पर आवेदन करें (pmsuryaghar.gov.in) ↗",
    citations_tag: "सत्यापनीय अनुसंधान, पोर्टल एवं मानक",
    citations_h2: "आधिकारिक सरकारी पोर्टल एवं अनुसंधान संदर्भ",
    citations_sub: "UrjaSetu EMS वैधानिक विनियमों, आधिकारिक मौसम संबंधी फ़ीड और खुले ऊर्जा नेटवर्क प्रोटोकॉल पर आधारित है।"
  }
};

let currentLang = 'en';
let activeHub = 'mathura';
let simHour = 13;
let batterySoC = 50;
let countersAnimated = false;
let autoSimInterval = null;
let isSimulating = false;

// ============================================================================
// 21st.dev CELESTIAL THEME TOGGLE (EXECUTIVE ALABASTER & OBSIDIAN MISSION CONTROL)
// ============================================================================
function initCelestialTheme() {
  const btn = document.getElementById('btn-theme-toggle');
  const savedTheme = localStorage.getItem('urjasetu_theme') || 'light';
  setThemeMode(savedTheme);

  if (btn) {
    btn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      setThemeMode(nextTheme);
    });
  }
}

function setThemeMode(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('urjasetu_theme', theme);
  // Re-draw chart with active theme colors
  setTimeout(() => {
    drawDispatchChart();
    initSparklines();
  }, 100);
}

// ============================================================================
// 21st.dev SPOTLIGHT EFFECT INITIALIZER
// ============================================================================
function initSpotlightCards() {
  const cards = document.querySelectorAll('.card-spotlight');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });
}

// ============================================================================
// REAL-TIME IST CLOCK
// ============================================================================
function updateISTClock() {
  const el = document.getElementById('live-ist-clock');
  if (!el) return;
  const now = new Date();
  const istOffset = 5.5 * 60;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (istOffset * 60000));
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  const s = String(ist.getSeconds()).padStart(2, '0');
  el.textContent = `${h}:${m}:${s} IST`;
}

// ============================================================================
// ANIMATE NUMBER COUNTERS
// ============================================================================
function animateCounters() {
  if (countersAnimated) return;
  countersAnimated = true;
  const counters = document.querySelectorAll('.counter');
  counters.forEach(el => {
    const target = parseFloat(el.dataset.target);
    const decimals = parseInt(el.dataset.decimals) || 0;
    const duration = 1400;
    const startTime = performance.now();

    function update(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const val = target * ease;
      el.textContent = decimals > 0 ? val.toFixed(decimals) : Math.round(val);
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = decimals > 0 ? target.toFixed(decimals) : target;
      }
    }
    requestAnimationFrame(update);
  });
}

// ============================================================================
// SPARKLINE CHARTS
// ============================================================================
function drawSparkline(containerId, color, dataPoints) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const w = container.offsetWidth || 180;
  const h = 32;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const min = Math.min(...dataPoints);
  const max = Math.max(...dataPoints);
  const range = max - min || 1;
  const pad = 3;
  const step = (w - pad * 2) / (dataPoints.length - 1);

  ctx.beginPath();
  dataPoints.forEach((d, i) => {
    const x = pad + i * step;
    const y = h - pad - ((d - min) / range) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Area under curve
  ctx.lineTo(w - pad, h);
  ctx.lineTo(pad, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ', 0.2)'));
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

function initSparklines() {
  drawSparkline('sparkline-dni', 'rgb(217, 119, 6)', [420, 510, 630, 710, 755, 772, 768, 740]);
  drawSparkline('sparkline-gen', 'rgb(5, 150, 105)', [1.2, 3.4, 5.8, 7.6, 8.8, 9.1, 8.9, 8.4]);
  drawSparkline('sparkline-co2', 'rgb(2, 132, 199)', [12, 18, 25, 33, 41, 48.9, 52, 55]);
  drawSparkline('sparkline-latency', 'rgb(124, 58, 237)', [0.18, 0.16, 0.15, 0.14, 0.14, 0.14, 0.13, 0.14]);
}

// ============================================================================
// HEADER STICKY & SCROLL LISTENER
// ============================================================================
function initHeaderScroll() {
  const header = document.getElementById('site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 30) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

// ============================================================================
// MOBILE MENU TOGGLE
// ============================================================================
function initMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', () => {
    menu.classList.toggle('mobile-open');
  });
  menu.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      menu.classList.remove('mobile-open');
    });
  });
}

// ============================================================================
// ACTIVE NAV HIGHLIGHT
// ============================================================================
function initActiveNav() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(s => {
      const top = s.offsetTop - 140;
      if (window.scrollY >= top) current = s.getAttribute('id');
    });
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
  });
}

// ============================================================================
// BILINGUAL LANGUAGE TOGGLE
// ============================================================================
function initLanguageToggle() {
  const btn = document.getElementById('btn-language-toggle');
  const label = document.getElementById('lang-label');
  if (!btn) return;

  btn.addEventListener('click', () => {
    currentLang = currentLang === 'en' ? 'hi' : 'en';
    label.textContent = currentLang === 'en' ? 'EN / HI' : 'HI / EN';
    applyTranslations();
  });
}

function applyTranslations() {
  const dict = I18N[currentLang];
  if (!dict) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
}

// ============================================================================
// SCENARIO CARD & REGIONAL HUB SELECTION
// ============================================================================
function initScenarioCards() {
  document.querySelectorAll('.scenario-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      activeHub = card.dataset.scenario;
      const dropdown = document.getElementById('hub-selector-dropdown');
      if (dropdown) dropdown.value = activeHub;
      updateHubData();
    });
  });
}

function initHubDropdown() {
  const dropdown = document.getElementById('hub-selector-dropdown');
  if (!dropdown) return;
  dropdown.addEventListener('change', (e) => {
    activeHub = e.target.value;
    document.querySelectorAll('.scenario-card').forEach(c => {
      c.classList.toggle('active', c.dataset.scenario === activeHub);
    });
    updateHubData();
  });
}

// ============================================================================
// UPDATE HUB DATA DYNAMICALLY
// ============================================================================
function updateHubData() {
  const hub = REGIONAL_HUBS[activeHub];
  if (!hub) return;

  // 0. Update Citizen Savings & Outage Gauge
  const citizenSavingsEl = document.getElementById('citizen-savings-val');
  if (citizenSavingsEl && hub.monthlySavings) {
    citizenSavingsEl.textContent = `${hub.monthlySavings}/mo (${hub.dailySavings}/day)`;
  }
  const appLightsEl = document.getElementById('app-hours-lights');
  if (appLightsEl && hub.appliances) appLightsEl.textContent = hub.appliances.lights;
  const appFansEl = document.getElementById('app-hours-fans');
  if (appFansEl && hub.appliances) appFansEl.textContent = hub.appliances.fans;
  const appFridgeEl = document.getElementById('app-hours-fridge');
  if (appFridgeEl && hub.appliances) appFridgeEl.textContent = hub.appliances.fridge;
  const appWifiEl = document.getElementById('app-hours-wifi');
  if (appWifiEl && hub.appliances) appWifiEl.textContent = hub.appliances.wifi;

  // 1. Array Badge & Generation
  const arrayBadge = document.getElementById('badge-kwp-array');
  if (arrayBadge) arrayBadge.textContent = `${hub.kwp.toFixed(1)} kWp Array`;

  const solarFrac = (simHour >= 6 && simHour <= 18) ? Math.sin((simHour - 6) / 12 * Math.PI) : 0;
  const cloudMult = 1 - (hub.cloudBase / 100) * 0.75;
  const activeGen = hub.kwp * solarFrac * cloudMult * 0.88;
  const genEl = document.getElementById('val-active-gen');
  if (genEl) genEl.textContent = activeGen.toFixed(1);

  // 2. DNI & GTI
  const dniBase = 840 * solarFrac * cloudMult;
  const dniEl = document.getElementById('val-solar-dni');
  if (dniEl) dniEl.textContent = Math.round(dniBase);

  const pillDni = document.getElementById('pill-dni');
  if (pillDni) pillDni.textContent = `${Math.round(dniBase)} W/m²`;

  const pillGti = document.getElementById('pill-gti');
  if (pillGti) pillGti.textContent = `${Math.round(dniBase * 0.92)} W/m²`;

  const pillCloud = document.getElementById('pill-cloud');
  if (pillCloud) pillCloud.textContent = `${hub.cloudBase}%`;

  const pillKt = document.getElementById('pill-kt');
  if (pillKt) pillKt.textContent = (0.95 * cloudMult).toFixed(2);

  // 3. Primary Satellite
  const satNameEl = document.getElementById('sat-primary-name');
  if (satNameEl) satNameEl.textContent = hub.satellite;

  const satZoneEl = document.getElementById('sat-navic-zone');
  if (satZoneEl) satZoneEl.textContent = hub.zone;

  // 4. Solar Arc Sun Node Position
  updateSunArc(simHour);

  // 5. Sankey Diagram
  const sankeySolar = document.getElementById('sankey-solar-val');
  if (sankeySolar) sankeySolar.textContent = `${activeGen.toFixed(1)} kW`;

  const facilityLoad = hub.demandKw * (0.65 + 0.35 * Math.sin((simHour - 8) / 16 * Math.PI));
  const sankeyDemand = document.getElementById('sankey-demand-val');
  if (sankeyDemand) sankeyDemand.textContent = `${facilityLoad.toFixed(1)} kW`;

  const surplus = activeGen - facilityLoad;
  const bessVal = Math.max(-2.5, Math.min(3.0, surplus * 0.45));
  const sankeyBess = document.getElementById('sankey-bess-val');
  if (sankeyBess) sankeyBess.textContent = `${bessVal >= 0 ? '+' : ''}${bessVal.toFixed(1)} kW`;

  const p2pExport = Math.max(0, surplus - bessVal);
  const sankeyGrid = document.getElementById('sankey-grid-val');
  if (sankeyGrid) sankeyGrid.textContent = `${p2pExport.toFixed(1)} kW`;

  // 6. Citizen Savings & Appliance Survival
  const dailyGenKwh = hub.kwp * hub.insolation * 0.78;
  const savingsRs = Math.round(dailyGenKwh * (hub.tariffPeak - 4.5));
  const savEl = document.getElementById('citizen-savings-val');
  if (savEl) savEl.textContent = `₹${savingsRs.toLocaleString('en-IN')}`;

  const battRemaining = (hub.batteryKwh * (batterySoC / 100));
  setApplianceHours('app-hours-lights', Math.round(battRemaining / 0.05));
  setApplianceHours('app-hours-fans', Math.round(battRemaining / 0.15));
  setApplianceHours('app-hours-fridge', Math.round(battRemaining / 0.25));
  setApplianceHours('app-hours-pump', Math.max(1, Math.round(battRemaining / 0.9)));

  // Redraw Dispatch Canvas
  drawDispatchChart();
}

function setApplianceHours(id, h) {
  const el = document.getElementById(id);
  if (el) el.textContent = `${h}h`;
}

function updateSunArc(hour) {
  const sunNode = document.getElementById('animated-sun-node');
  const angleText = document.getElementById('sun-zenith-angle-text');
  if (!sunNode) return;

  const progress = Math.max(0, Math.min(1, (hour - 6) / 12));
  const angleRad = Math.PI * (1 - progress);
  const cx = 250 - 200 * Math.cos(angleRad);
  const cy = 115 - 85 * Math.sin(angleRad);

  sunNode.setAttribute('transform', `translate(${cx}, ${cy})`);

  const elevationDeg = (Math.sin(angleRad) * 78.5).toFixed(1);
  if (angleText) {
    angleText.textContent = hour >= 6 && hour <= 18 ? `Solar Elevation: ${elevationDeg}°` : 'Sun below horizon (Night)';
  }
}

// ============================================================================
// HiGHS CONVEX LP 24H DISPATCH CANVAS (ADAPTIVE THEME RENDERING)
// ============================================================================
function drawDispatchChart() {
  const canvas = document.getElementById('dispatchSplineCanvas');
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = container.offsetWidth || 800;
  const H = container.offsetHeight || 380;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const hub = REGIONAL_HUBS[activeHub] || REGIONAL_HUBS.pune;
  const pad = { top: 30, right: 35, bottom: 45, left: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  // Generate data points
  const hours = [];
  const solarData = [];
  const loadData = [];
  const p2pData = [];

  for (let h = 0; h <= 24; h += 0.5) {
    hours.push(h);
    const sFrac = (h >= 6 && h <= 18) ? Math.sin((h - 6) / 12 * Math.PI) : 0;
    const cloudMult = 1 - (hub.cloudBase / 100) * 0.75;
    const gen = hub.kwp * sFrac * cloudMult * 0.88;
    const load = hub.demandKw * (0.65 + 0.35 * Math.sin((h - 8) / 16 * Math.PI));
    const surplus = Math.max(0, gen - load);

    solarData.push(gen);
    loadData.push(load);
    p2pData.push(surplus * 0.55);
  }

  const maxVal = Math.max(...solarData, ...loadData) * 1.18 || 20;

  function toX(h) { return pad.left + (h / 24) * chartW; }
  function toY(v) { return pad.top + chartH - (v / maxVal) * chartH; }

  ctx.clearRect(0, 0, W, H);

  // Horizontal Grid Lines
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';
  const labelColor = isDark ? '#94a3b8' : '#64748b';

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (i / 5) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();

    const val = (maxVal * (1 - i / 5)).toFixed(1);
    ctx.fillStyle = labelColor;
    ctx.font = '10px "Geist Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${val} kW`, pad.left - 10, y + 4);
  }

  // Vertical Grid Lines (Time)
  for (let h = 0; h <= 24; h += 4) {
    const x = toX(h);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();

    ctx.fillStyle = labelColor;
    ctx.font = '11px "Geist", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, pad.top + chartH + 20);
  }

  // Curve Drawing Helper
  function drawFilledCurve(data, strokeColor, fillColor) {
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = toX(hours[i]);
      const y = toY(v);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevX = toX(hours[i - 1]);
        const prevY = toY(data[i - 1]);
        const cpX = (prevX + x) / 2;
        ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
      }
    });

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Fill
    ctx.lineTo(toX(24), toY(0));
    ctx.lineTo(toX(0), toY(0));
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // 1. Solar Curve (Amber)
  const gradSolar = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  gradSolar.addColorStop(0, isDark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(217, 119, 6, 0.2)');
  gradSolar.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
  drawFilledCurve(solarData, isDark ? '#f59e0b' : '#d97706', gradSolar);

  // 2. Load Profile (Cyan)
  const gradLoad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  gradLoad.addColorStop(0, isDark ? 'rgba(6, 182, 212, 0.22)' : 'rgba(2, 132, 199, 0.16)');
  gradLoad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
  drawFilledCurve(loadData, isDark ? '#06b6d4' : '#0284c7', gradLoad);

  // 3. P2P Export Surplus (Purple)
  const gradP2p = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  gradP2p.addColorStop(0, 'rgba(124, 58, 237, 0.18)');
  gradP2p.addColorStop(1, 'rgba(124, 58, 237, 0.0)');
  drawFilledCurve(p2pData, '#7c3aed', gradP2p);

  // 4. Active Simulation Hour Laser Cursor
  const curX = toX(simHour);
  ctx.beginPath();
  ctx.moveTo(curX, pad.top);
  ctx.lineTo(curX, pad.top + chartH);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scrubber dot at top
  ctx.beginPath();
  ctx.arc(curX, pad.top + 6, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ============================================================================
// 21st.dev 24H AUTONOMOUS DISPATCH SIMULATION ENGINE
// ============================================================================
function initAutoSimulator() {
  const btn = document.getElementById('btn-auto-simulate');
  const hourSlider = document.getElementById('slider-hour-input');
  const hourText = document.getElementById('hour-display-text');
  const playText = document.getElementById('play-text');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (isSimulating) {
      // Pause
      clearInterval(autoSimInterval);
      isSimulating = false;
      btn.classList.remove('playing');
      if (playText) playText.textContent = '▶ Run 24H Auto-Simulation';
    } else {
      // Play
      isSimulating = true;
      btn.classList.add('playing');
      if (playText) playText.textContent = '⏸ Pause Simulation';

      autoSimInterval = setInterval(() => {
        simHour += 0.25;
        if (simHour > 24) simHour = 0;

        if (hourSlider) hourSlider.value = simHour;

        const h = Math.floor(simHour);
        const m = simHour % 1 === 0 ? '00' : simHour % 1 === 0.5 ? '30' : simHour % 1 === 0.25 ? '15' : '45';
        if (hourText) hourText.textContent = `${String(h).padStart(2, '0')}:${m} IST`;

        const timeBadge = document.getElementById('power-flow-time-indicator');
        if (timeBadge) timeBadge.textContent = `${String(h).padStart(2, '0')}:${m} IST`;

        updateHubData();
      }, 100);
    }
  });
}

// ============================================================================
// DISPATCH SLIDER CONTROLS
// ============================================================================
function initDispatchControls() {
  const socSlider = document.getElementById('slider-soc-input');
  const hourSlider = document.getElementById('slider-hour-input');
  const socText = document.getElementById('soc-display-text');
  const hourText = document.getElementById('hour-display-text');

  if (socSlider) {
    socSlider.addEventListener('input', () => {
      batterySoC = parseInt(socSlider.value);
      if (socText) socText.textContent = `${batterySoC}%`;
      updateHubData();
    });
  }

  if (hourSlider) {
    hourSlider.addEventListener('input', () => {
      if (isSimulating) {
        clearInterval(autoSimInterval);
        isSimulating = false;
        const btn = document.getElementById('btn-auto-simulate');
        const playText = document.getElementById('play-text');
        if (btn) btn.classList.remove('playing');
        if (playText) playText.textContent = '▶ Run 24H Auto-Simulation';
      }
      simHour = parseFloat(hourSlider.value);
      const h = Math.floor(simHour);
      const m = simHour % 1 === 0 ? '00' : '30';
      if (hourText) hourText.textContent = `${String(h).padStart(2, '0')}:${m} IST`;
      const timeBadge = document.getElementById('power-flow-time-indicator');
      if (timeBadge) timeBadge.textContent = `${String(h).padStart(2, '0')}:${m} IST`;
      updateHubData();
    });
  }
}

// ============================================================================
// PM SURYA GHAR CALCULATOR
// ============================================================================
function initSubsidyCalculator() {
  const unitsSlider = document.getElementById('slider-subsidy-units');
  const capSlider = document.getElementById('slider-subsidy-cap');
  const unitsText = document.getElementById('calc-units-text');
  const capText = document.getElementById('calc-capacity-text');

  function calculate() {
    const units = unitsSlider ? parseInt(unitsSlider.value) : 240;
    const cap = capSlider ? parseFloat(capSlider.value) : 3;

    if (unitsText) unitsText.textContent = `${units} Units`;
    if (capText) capText.textContent = `${cap.toFixed(1)} kW`;

    // MNRE Official Subsidy slabs
    let subsidy = 0;
    if (cap <= 1) subsidy = 30000;
    else if (cap <= 2) subsidy = 60000;
    else subsidy = 78000;

    const installCost = cap * 65000;
    const netCost = Math.max(0, installCost - subsidy);
    const annualGen = cap * 1400; // kWh/yr in India
    const avgTariff = 8.5; // ₹/kWh
    const annualSavings = Math.round(annualGen * avgTariff);
    const payback = netCost > 0 ? (netCost / annualSavings).toFixed(1) : '0.0';

    const subEl = document.getElementById('calc-res-subsidy');
    if (subEl) subEl.textContent = `₹${subsidy.toLocaleString('en-IN')}`;

    const netEl = document.getElementById('calc-res-net');
    if (netEl) netEl.textContent = `₹${netCost.toLocaleString('en-IN')}`;

    const annEl = document.getElementById('calc-res-annual');
    if (annEl) annEl.textContent = `₹${annualSavings.toLocaleString('en-IN')}/yr`;

    const payEl = document.getElementById('calc-res-payback');
    if (payEl) payEl.textContent = `${payback} Years`;
  }

  if (unitsSlider) unitsSlider.addEventListener('input', calculate);
  if (capSlider) capSlider.addEventListener('input', calculate);
  calculate();
}

// ============================================================================
// WHATSAPP POWER-CUT ALERT TRIGGER
// ============================================================================
function triggerWhatsAppAlert() {
  const toast = document.getElementById('toast-notification');
  const msg = document.getElementById('toast-message');
  if (!toast) return;

  const hub = REGIONAL_HUBS[activeHub] || REGIONAL_HUBS.pune;
  if (msg) {
    msg.textContent = `WhatsApp Alert sent to ${hub.name} feeder prosumers!`;
  }
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3800);
}
window.triggerWhatsAppAlert = triggerWhatsAppAlert;

// ============================================================================
// LENIS SMOOTH SCROLL & GSAP INITIALIZER
// ============================================================================
function initSmoothMotion() {
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 900);
  if (!isTouch && typeof Lenis !== 'undefined') {
    try {
      const lenis = new Lenis({
        duration: 1.15,
        easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });

      function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);

      if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add(time => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
      }
    } catch (e) {
      console.warn('Lenis init:', e);
    }
  }
}

// ============================================================================
// RESIZE HANDLER
// ============================================================================
function initResizeHandler() {
  let timeout;
  window.addEventListener('resize', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      drawDispatchChart();
      initSparklines();
    }, 200);
  });
}

// ============================================================================

// ============================================================================
// ARKA AI COPILOT INTERACTION ENGINE
// ============================================================================
function initArkaAiCopilot() {
  const askBtn = document.getElementById('btn-arka-ask');
  const inputEl = document.getElementById('arka-web-query-input');
  const resBox = document.getElementById('arka-web-response-box');
  const headlineEl = document.getElementById('arka-res-headline');
  const bodyEl = document.getElementById('arka-res-body');
  const actionEl = document.getElementById('arka-res-action');

  if (!askBtn || !inputEl || !resBox) return;

  function handleQuery(queryText) {
    if (!queryText || !queryText.trim()) return;
    const q = queryText.toLowerCase();
    const hub = REGIONAL_HUBS[activeHub] || REGIONAL_HUBS.mathura;

    let headline = "Arka AI Grounded Dispatch Intelligence";
    let body = "";
    let action = "";

    if (q.includes("save") || q.includes("bill") || q.includes("money") || q.includes("subsidy")) {
      headline = `Monthly Bill Savings Analysis for ${hub.name}`;
      body = `With your ${hub.kwp.toFixed(1)} kWp rooftop solar array and ${hub.batteryKwh.toFixed(1)} kWh storage, your projected monthly bill decreases from ${hub.oldBill} to ${hub.newBill}, keeping ${hub.monthlySavings} in your pocket every single month (${hub.dailySavings} saved per day). Additionally, under the PM Surya Ghar: Muft Bijli Yojana, a statutory central capital subsidy of ₹78,000 applies with an expected 3.2-year payback.`;
      action = `⚡ Recommended Action: Keep solar self-consumption priority active between 09:00 and 15:30 IST to avoid Peak DISCOM tariff.`;
    } else if (q.includes("blackout") || q.includes("survive") || q.includes("tonight") || q.includes("outage")) {
      headline = `CEEW Emergency Blackout Resilience for ${hub.name}`;
      body = `Your dynamic blackout reserve floor is held at ${hub.outageReserve || 35}% based on ${hub.state} feeder reliability data. Your ${hub.batteryKwh.toFixed(1)} kWh battery will sustain your critical essential appliances throughout an outage: LED Lights (${hub.appliances.lights}), Ceiling Fans (${hub.appliances.fans}), Refrigerator (${hub.appliances.fridge}), and Wi-Fi Router (${hub.appliances.wifi}).`;
      action = `🛡️ Outage Shield Status: ACTIVE • Zero unserved critical load guaranteed.`;
    } else if (q.includes("appliance") || q.includes("wash") || q.includes("geyser") || q.includes("when")) {
      headline = `Optimal Solar Self-Consumption Windows for ${hub.name}`;
      body = `Based on ISRO INSAT-3DR solar nowcasting, peak generation occurs between 11:30 and 14:30 IST with an insolation index of ${hub.insolation} kWh/m²/day. Schedule high-draw loads during these zero-marginal-cost windows: Automatic Washing Machine (11:30 - 13:00 IST) and Water Geyser (12:30 - 14:00 IST).`;
      action = `⏰ Peak Shifting Benefit: Saves approximately ₹185/month in avoided peak time-of-day tariffs.`;
    } else if (q.includes("sell") || q.includes("p2p") || q.includes("neighbor") || q.includes("upi") || q.includes("trade")) {
      headline = `Beckn DEG v2.0 P2P Energy Trading & Instant UPI Settlement`;
      body = `Your surplus solar generation beyond 100% battery SoC is automatically posted to the decentralized P2P orderbook at ₹7.40/kWh (saving ₹2.40/kWh for your neighbor vs DISCOM peak rate). Matched trades clear instantly via statutory sandbox smart contract, with micro-settlements routed directly to your registered UPI VPA.`;
      action = `🤝 P2P Ledger: Active • 12.0 kWh export trade matched today under DISCOM sandbox approval.`;
    } else {
      headline = `Arka Energy Intelligence for ${hub.name}`;
      body = `Currently monitoring ${hub.name} (${hub.state}) with ${hub.kwp.toFixed(1)} kWp rooftop solar and ${hub.batteryKwh.toFixed(1)} kWh storage. The system is operating in balanced mode with real-time INSAT-3DR nowcasting and dynamic reserve protection.`;
      action = `⚡ Grid status: NOMINAL (50.01 Hz) • Anti-islanding trip latency 0.14s.`;
    }

    headlineEl.textContent = headline;
    bodyEl.textContent = body;
    actionEl.textContent = action;
    resBox.style.display = 'block';
  }

  askBtn.addEventListener('click', () => {
    handleQuery(inputEl.value);
  });

  inputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleQuery(inputEl.value);
    }
  });

  document.querySelectorAll('.arka-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      inputEl.value = q;
      handleQuery(q);
    });
  });
}

// DOM READY INITIALIZER
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initArkaAiCopilot();
  initCelestialTheme();
  initSpotlightCards();
  initHeaderScroll();
  initMobileMenu();
  initActiveNav();
  initLanguageToggle();
  initScenarioCards();
  initHubDropdown();
  initDispatchControls();
  initAutoSimulator();
  initSubsidyCalculator();
  initSmoothMotion();
  initResizeHandler();

  // Load Initial Hub
  updateHubData();

  // Draw Visuals
  setTimeout(() => {
    drawDispatchChart();
    initSparklines();
    animateCounters();
  }, 250);

  // IST Clock interval
  updateISTClock();
  setInterval(updateISTClock, 1000);

  // Periodic Telemetry Micro-Jitter (Simulated live feed)
  setInterval(() => {
    const dniEl = document.getElementById('val-solar-dni');
    if (dniEl) {
      const cur = parseInt(dniEl.textContent) || 770;
      dniEl.textContent = cur + Math.round((Math.random() - 0.5) * 6);
    }

    const freqEl = document.getElementById('top-grid-freq');
    if (freqEl) {
      const baseFreq = 50.00;
      const jitter = (Math.random() - 0.5) * 0.04;
      freqEl.textContent = `${(baseFreq + jitter).toFixed(2)} Hz`;
    }
  }, 3000);
});
