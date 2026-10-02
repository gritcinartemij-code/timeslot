const state={me:null,specialists:[],dashboard:null,currentSpec:null};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
async function api(path,options={}){
  const res=await fetch(path,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||"Ошибка");
  return data;
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800);}
function modal(html){$("#modalContent").innerHTML=html;$("#modalBackdrop").classList.add("show");}
function closeModal(){$("#modalBackdrop").classList.remove("show");}
$("#closeModal").onclick=closeModal;$("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")closeModal()};

function authModal(kind="register"){
  if(kind==="register") modal(`<h2>Создать аккаунт</h2><p>Специалист создаёт страницу и свободные слоты. Клиент может зарегистрироваться для управления своими записями.</p>
    <form id="authForm" class="form"><label>Имя<input name="name" required minlength="2" placeholder="Ваше имя"></label>
    <label>Email<input name="email" type="email" required placeholder="you@example.com"></label>
    <label>Пароль<input name="password" type="password" required minlength="6" placeholder="Минимум 6 символов"></label>
    <label>Тип аккаунта<select name="role"><option value="specialist">Я специалист</option><option value="client">Я клиент</option></select></label>
    <button class="primary full">Создать аккаунт</button></form>
    <p class="switch">Уже есть аккаунт? <button id="switchAuth">Войти</button></p>`);
  else modal(`<h2>Войти</h2><p>Войдите в личный кабинет.</p><form id="authForm" class="form">
    <label>Email<input name="email" type="email" required></label><label>Пароль<input name="password" type="password" required></label>
    <button class="primary full">Войти</button></form><p class="switch">Нет аккаунта? <button id="switchAuth">Зарегистрироваться</button></p>`);
  $("#authForm").onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.target), body=Object.fromEntries(f);
    try{const d=await api(kind==="register"?"/api/register":"/api/login",{method:"POST",body:JSON.stringify(body)});state.me=d.user;closeModal();renderHeader();toast("Готово ✓");if(location.hash==="#dashboard")loadDashboard();}catch(err){toast(err.message);}
  };
  $("#switchAuth").onclick=()=>authModal(kind==="register"?"login":"register");
}
function renderHeader(){
  $("#accountArea").innerHTML=state.me?`<a class="header-user" href="#dashboard">${esc(state.me.name)}</a><button class="ghost" id="logoutBtn">Выйти</button>`:`<button class="ghost" id="loginBtn">Войти</button><button class="primary small" id="registerBtn">Регистрация</button>`;
  $("#loginBtn")?.addEventListener("click",()=>authModal("login"));$("#registerBtn")?.addEventListener("click",()=>authModal("register"));
  $("#logoutBtn")?.addEventListener("click",async()=>{await api("/api/logout",{method:"POST"});state.me=null;renderHeader();showHome();toast("Вы вышли");});
}
async function loadMe(){try{state.me=(await api("/api/me")).user}catch{}renderHeader();}
function showHome(){loadSpecialists();window.scrollTo({top:0,behavior:"smooth"});}
async function loadSpecialists(){
  const d=await api("/api/specialists");state.specialists=d.specialists;
  $("#specialistsGrid").innerHTML=d.specialists.map(s=>`
    <article class="specialist"><div class="avatar">${esc(s.avatar)}</div><div class="spec-info"><h3>${esc(s.name)}</h3><p>${esc(s.service?.title||"Специалист")}</p><div><span class="star">★</span> 4.9</div><strong>${s.service?esc(s.service.price)+" ₽":""}</strong>
    <button class="outline bookBtn" data-slug="${esc(s.slug)}">Посмотреть</button></div></article>`).join("");
  $$(".bookBtn").forEach(b=>b.onclick=()=>openSpecialist(b.dataset.slug));
}
async function openSpecialist(slug){
  try{
    const d=await api("/api/specialists/"+encodeURIComponent(slug));state.currentSpec=d;
    const groups={};d.slots.forEach(x=>(groups[x.date]??=[]).push(x));
    const days=Object.entries(groups);
    modal(`<div class="public-profile"><div class="profile-big"><div class="avatar big">${esc(d.specialist.avatar)}</div><div><h2>${esc(d.specialist.name)}</h2><p>${esc(d.specialist.bio||"Специалист TimeSlot")}</p></div></div>
      <h3>Услуги</h3>${d.services.map(s=>`<div class="service-line"><div><b>${esc(s.title)}</b><small>${esc(s.description||"")} · ${s.duration} мин.</small></div><strong>${s.price} ₽</strong></div>`).join("")}
      <h3>Свободное время</h3>${days.length?days.map(([date,slots])=>`<div class="day"><b>${new Date(date+"T12:00").toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long"})}</b><div class="slot-list">${slots.map(x=>`<button class="slotBtn" data-slot="${x.id}">${x.time}</button>`).join("")}</div></div>`).join(""):`<p>Свободного времени пока нет.</p>`}
    </div>`);
    $$(".slotBtn").forEach(b=>b.onclick=()=>bookingModal(b.dataset.slot));
  }catch(e){toast(e.message);}
}
function bookingModal(slotId){
  const slot=state.currentSpec.slots.find(x=>x.id===slotId);
  if(!state.me){modal(`<h2>Войдите, чтобы записаться</h2><p>После входа вы сможете подтвердить запись.</p><button class="primary full" id="goLogin">Войти</button>`);$("#goLogin").onclick=()=>authModal("login");return;}
  modal(`<h2>Подтвердить запись</h2><p>${esc(state.currentSpec.specialist.name)} · ${esc(slot.date)} · ${esc(slot.time)}</p>
    <form id="bookForm" class="form"><label>Ваше имя<input name="clientName" required value="${esc(state.me.name)}"></label>
    <label>Контакт<input name="contact" required value="${esc(state.me.email)}"></label>
    <button class="primary full">Подтвердить запись</button></form>`);
  $("#bookForm").onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));body.slotId=slotId;
    try{await api("/api/bookings",{method:"POST",body:JSON.stringify(body)});closeModal();toast("Запись подтверждена ✓");openSpecialist(state.currentSpec.specialist.slug);}catch(err){toast(err.message);}};
}
async function loadDashboard(){
  if(!state.me){authModal("login");return;}
  const d=await api("/api/dashboard");state.dashboard=d;
  $("#app").innerHTML=`<section class="dashboard section"><div class="dash-head"><div><span class="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span><h1>Привет, ${esc(d.user.name)} 👋</h1><p>${d.user.role==="specialist"?"Управляйте услугами и свободным временем.":"Управляйте своими записями."}</p></div><a class="secondary" href="#home">На главную</a></div>
  ${d.user.role==="specialist"?specialistDash(d):clientDash(d)}</section>`;
  if(d.user.role==="specialist")bindSpecialistDash();
}
function specialistDash(d){
 return `<div class="dash-grid"><div class="panel"><div class="panel-head"><h2>Мои услуги</h2></div><div id="serviceList">${d.services.filter(s=>s.active).map(s=>`<div class="service-line"><div><b>${esc(s.title)}</b><small>${esc(s.description||"")}</small></div><strong>${s.price} ₽</strong></div>`).join("")||"<p>Пока нет услуг.</p>"}</div>
 <form id="serviceForm" class="form inline-form"><input name="title" placeholder="Название услуги" required><input name="price" type="number" min="0" placeholder="Цена, ₽" required><input name="description" placeholder="Короткое описание"><button class="primary">Добавить услугу</button></form></div>
 <div class="panel"><div class="panel-head"><h2>Добавить свободное время</h2></div><form id="slotForm" class="form"><label>Услуга<select name="serviceId">${d.services.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select></label><label>Дата<input type="date" name="date" required></label><label>Время<input type="time" name="time" required></label><button class="primary">Добавить слот</button></form></div></div>
 <div class="panel"><div class="panel-head"><h2>Мои записи</h2><span>${d.bookings.length}</span></div><div class="booking-list">${d.bookings.length?d.bookings.map(b=>`<div class="booking"><b>${esc(b.date)} · ${esc(b.time)}</b><span>${esc(b.clientName)} · ${esc(d.services.find(s=>s.id===b.serviceId)?.title||"Услуга")}</span><small>${esc(b.contact)}</small><em>${b.status}</em></div>`).join(""):"<p>Записей пока нет.</p>"}</div></div>
 <div class="panel"><div class="panel-head"><h2>Мои свободные слоты</h2></div><div class="slot-admin">${d.slots.filter(s=>!s.booked).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(s=>`<span>${s.date} · ${s.time}<button data-delete-slot="${s.id}">×</button></span>`).join("")||"<p>Нет свободных слотов.</p>"}</div></div>`;
}
function clientDash(d){
 return `<div class="panel"><div class="panel-head"><h2>Мои записи</h2></div>${d.bookings.length?d.bookings.map(b=>{const spec=state.specialists.find(s=>s.id===b.specialistId);return `<div class="booking"><b>${esc(b.date)} · ${esc(b.time)}</b><span>${esc(spec?.name||"Специалист")} · ${esc(spec?.service?.title||"Услуга")}</span><em>${b.status}</em></div>`}).join(""):"<p>У вас пока нет записей.</p>"}</div>`;
}
function bindSpecialistDash(){
 $("#serviceForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/services",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast("Услуга добавлена ✓");loadDashboard();}catch(err){toast(err.message);}};
 $("#slotForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/slots",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast("Время добавлено ✓");loadDashboard();}catch(err){toast(err.message);}};
 $$("[data-delete-slot]").forEach(b=>b.onclick=async()=>{try{await api("/api/slots/"+b.dataset.deleteSlot,{method:"DELETE"});loadDashboard();}catch(e){toast(e.message);}});
}
function route(){if(location.hash==="#dashboard")loadDashboard();else {renderHome();loadSpecialists();}}
function renderHome(){ $("#app").innerHTML=$("#homeTemplate").innerHTML; $$(".navlink").forEach(a=>a.onclick=()=>{}); }
window.addEventListener("hashchange",route);
loadMe().then(route);
