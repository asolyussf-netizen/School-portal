const $ = s => document.querySelector(s);
let currentUser = null;
let teachersCache = [];
const roleNames = {director:"المدير",technician:"الشخص الفني",teacher:"مدرس",family:"طالب / ولي أمر"};
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.remove("hidden");setTimeout(()=>el.classList.add("hidden"),3200);}
async function api(url, options={}) {
  const res=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||"حدث خطأ غير متوقع.");
  return data;
}
function showSection(id){document.querySelectorAll("#loginSection,#dashboard").forEach(e=>e.classList.add("hidden"));if(id)$("#"+id).classList.remove("hidden");}
function initials(name){return (name||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("");}
function showLogin(){showSection("loginSection");$("#loginSection").scrollIntoView({behavior:"smooth"});}
$("#loginNav").addEventListener("click",showLogin);$("#contactLogin").addEventListener("click",showLogin);
$("#logoutNav").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});currentUser=null;updateAuthUI();showSection(null);renderStaff((await api("/api/public")).staff);toast("تم تسجيل الخروج.");}catch(e){toast(e.message);}});
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();$("#loginError").textContent="";const form=new FormData(e.currentTarget);try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({username:form.get("username"),password:form.get("password")})});currentUser=d.user;updateAuthUI();e.currentTarget.reset();showSection("dashboard");await renderDashboard();$("#dashboard").scrollIntoView({behavior:"smooth"});}catch(err){$("#loginError").textContent=err.message;}});
function updateAuthUI(){const logged=!!currentUser;$("#loginNav").classList.toggle("hidden",logged);$("#logoutNav").classList.toggle("hidden",!logged);$("#sessionNote").textContent=logged?`تم تسجيل الدخول: ${currentUser.name} — ${roleNames[currentUser.role]}`:"بيانات التواصل متاحة للطلاب وأولياء الأمور بعد تسجيل الدخول.";}
async function loadPublic(){
 const d=await api("/api/public");const settings=d.settings||{};
 $("#schoolName").textContent=settings.school_name||"مدرستي";$("#footerSchool").textContent=settings.school_name||"مدرستي";
 $("#schoolDescription").textContent=settings.school_description||"منصة رسمية للتعريف بالمدرسة والتواصل مع الكادر.";
 $("#year").textContent=new Date().getFullYear();renderStaff(d.staff||[]);renderAnnouncements(d.announcements||[]);
}
function renderStaff(staff){
 const grid=$("#staffGrid");
 if(!staff.length){grid.innerHTML='<div class="empty">لم تتم إضافة الكادر بعد.</div>';return;}
 grid.innerHTML=staff.map(p=>`<article class="person-card"><div class="avatar">${esc(initials(p.name))}</div><div class="person-info"><h3>${esc(p.name)}</h3><p>${p.role==="director"?"مدير المدرسة":esc(p.subject||"عضو الكادر التدريسي")}</p>${currentUser&&["family","director","technician"].includes(currentUser.role)&&p.role==="teacher"?'<div class="person-actions"><button onclick="openTeacher('+p.id+')">وسائل التواصل</button></div>':""}</div></article>`).join("");
 if(currentUser&&["family","director","technician"].includes(currentUser.role)) loadContactButtons();
}
async function loadContactButtons(){
 try{const d=await api("/api/teachers");teachersCache=d.teachers||[];const grid=$("#staffGrid");grid.innerHTML=grid.innerHTML.replace(/<div class="person-info">/g,'<div class="person-info">');renderStaffWithContacts();}
 catch(e){}
}
function renderStaffWithContacts(){
 const grid=$("#staffGrid");const pub=grid.querySelectorAll(".person-card");
 // Public directory cards are rebuilt using contact data, while director is kept from public data.
 api("/api/public").then(d=>{
  const staff=d.staff||[];
  grid.innerHTML=staff.map(p=>{
   const t=teachersCache.find(x=>x.id===p.id);
   const controls=t?`<div class="person-actions">${t.whatsapp?`<a class="wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/${encodeURIComponent(t.whatsapp.replace(/^\+/,""))}">واتساب</a>`:""}${t.phone?`<a href="tel:${encodeURIComponent(t.phone)}">اتصال</a>`:""}<button onclick="openTeacher(${t.id})">رسالة</button></div>`:"";
   return `<article class="person-card"><div class="avatar">${esc(initials(p.name))}</div><div class="person-info"><h3>${esc(p.name)}</h3><p>${p.role==="director"?"مدير المدرسة":esc(p.subject||"عضو الكادر التدريسي")}</p>${controls}</div></article>`;
  }).join("");
 });
}
function openTeacher(id){const t=teachersCache.find(x=>x.id===id);if(!t)return;showSection("dashboard");$("#dashboard").scrollIntoView({behavior:"smooth"});renderMessages(id,t.name);}
function renderAnnouncements(items){
 const el=$("#announcementsGrid");if(!items.length){el.innerHTML='<div class="empty">لا توجد إعلانات حالياً.</div>';return;}
 el.innerHTML=items.map(a=>`<article class="announcement-card"><time>${esc(a.created_at||"")} · ${esc(a.author||"إدارة المدرسة")}</time><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></article>`).join("");
}
function dashboardShell(title,subtitle,role){
 $("#dashboardTitle").textContent=title;$("#dashboardSubtitle").textContent=subtitle;$("#rolePill").textContent=roleNames[role]||role;
}
async function renderDashboard(){
 if(!currentUser)return;
 if(currentUser.role==="director"){dashboardShell("لوحة المدير","إدارة الموقع والكادر والإعلانات والإعدادات.","director");await renderAdmin();}
 else if(currentUser.role==="technician"){dashboardShell("إدارة الأشخاص","يمكنك إضافة الأشخاص وتعديل بياناتهم فقط.","technician");await renderPeopleManager();}
 else if(currentUser.role==="teacher"){dashboardShell("حساب المدرس","صندوق الرسائل الواردة والصادرة للتواصل مع الطلاب وأولياء الأمور.","teacher");await renderMessages();}
 else {dashboardShell("بوابة التواصل","ابحث عن المدرس وتواصل معه عبر الوسائل المتاحة.","family");await renderFamily();}
}
function peopleForm(isDirector){
 return `<div class="panel"><h3>إضافة شخص</h3><form id="personForm" class="form-grid">
 <label>الاسم الكامل<input name="name" required maxlength="100"></label>
 <label>اسم المستخدم<input name="username" required maxlength="120"></label>
 <label>نوع الحساب<select name="role" required><option value="teacher">مدرس</option><option value="family">طالب / ولي أمر</option>${isDirector?'<option value="technician">الشخص الفني</option>':""}</select></label>
 <label>المادة / الاختصاص<input name="subject" maxlength="100"></label>
 <label>رقم الهاتف<input name="phone" type="tel" maxlength="30"></label>
 <label>رقم واتساب<input name="whatsapp" type="tel" maxlength="40"></label>
 <label>البريد الإلكتروني<input name="email" type="email" maxlength="120"></label>
 <label>كلمة المرور المؤقتة<input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
 <div class="span2"><button class="btn btn-primary" type="submit">إنشاء الحساب</button></div><p class="error span2" id="personError"></p>
 </form></div><div class="panel"><h3>الأشخاص المسجلون</h3><div id="peopleTable" class="table-wrap">جارٍ التحميل...</div></div>`;
}
async function renderPeopleManager(){
 $("#dashboardContent").innerHTML=peopleForm(currentUser.role==="director");
 $("#personForm").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/people",{method:"POST",body:JSON.stringify(data)});e.currentTarget.reset();toast("تم إنشاء الحساب.");await loadPeopleTable();}catch(err){$("#personError").textContent=err.message;}});
 await loadPeopleTable();
}
async function loadPeopleTable(){
 try{const d=await api("/api/people");$("#peopleTable").innerHTML=`<table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>نوع الحساب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${d.people.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.username)}</td><td>${esc(roleNames[p.role]||p.role)}</td><td><span class="status ${p.active?"":"off"}">${p.active?"نشط":"معطل"}</span></td><td>${p.role!=="director"?`<button class="btn btn-light" onclick="editPerson(${p.id})">تعديل</button>`:"—"}</td></tr>`).join("")}</tbody></table>`;}catch(e){$("#peopleTable").textContent=e.message;}
}
async function editPerson(id){
 const d=await api("/api/people");const p=d.people.find(x=>x.id===id);if(!p)return;
 const name=prompt("الاسم:",p.name);if(name===null)return;
 const phone=prompt("رقم الهاتف:",p.phone||"");if(phone===null)return;
 const whatsapp=prompt("رقم واتساب مع رمز الدولة:",p.whatsapp||"");if(whatsapp===null)return;
 const subject=prompt("المادة / الاختصاص:",p.subject||"");if(subject===null)return;
 const password=prompt("كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية):","");
 try{await api("/api/people/"+id,{method:"PATCH",body:JSON.stringify({name,username:p.username,role:p.role,phone,whatsapp,subject,email:p.email,password:password||undefined,active:!!p.active})});toast("تم تحديث البيانات.");await loadPeopleTable();}catch(e){toast(e.message);}
}
async function renderAdmin(){
 $("#dashboardContent").innerHTML=`<div class="dashboard-grid"><div class="panel"><h3>إعدادات المدرسة</h3><form id="settingsForm" class="form-grid"><label class="span2">اسم المدرسة<input name="school_name"></label><label class="span2">اسم المدير<input name="director_name"></label><label class="span2">وصف المدرسة<textarea name="school_description"></textarea></label><button class="btn btn-primary" type="submit">حفظ الإعدادات</button></form></div><div class="panel"><h3>نشر إعلان جديد</h3><form id="announcementForm" class="form-grid"><label class="span2">عنوان الإعلان<input name="title" required></label><label class="span2">نص الإعلان<textarea name="body" required></textarea></label><button class="btn btn-primary" type="submit">نشر الإعلان</button></form><div id="adminAnnouncements"></div></div></div>${peopleForm(true)}`;
 const pub=await api("/api/public");const f=$("#settingsForm");f.school_name.value=pub.settings.school_name||"";f.director_name.value=pub.settings.director_name||"";f.school_description.value=pub.settings.school_description||"";
 f.addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/settings",{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(f)))});toast("تم حفظ الإعدادات.");await loadPublic();}catch(err){toast(err.message);}});
 $("#announcementForm").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/announcements",{method:"POST",body:JSON.stringify(data)});e.currentTarget.reset();toast("تم نشر الإعلان.");await loadPublic();}catch(err){toast(err.message);}});
 $("#personForm").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/people",{method:"POST",body:JSON.stringify(data)});e.currentTarget.reset();toast("تم إنشاء الحساب.");await loadPeopleTable();}catch(err){$("#personError").textContent=err.message;}});
 await loadPeopleTable();await loadAdminAnnouncements();
}
async function loadAdminAnnouncements(){
 const d=await api("/api/announcements");const el=$("#adminAnnouncements");el.innerHTML=d.announcements.map(a=>`<div class="message"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><button class="btn btn-light" onclick="deleteAnnouncement(${a.id})">حذف الإعلان</button></div>`).join("")||'<p class="muted">لا توجد إعلانات.</p>';
}
async function deleteAnnouncement(id){if(!confirm("هل تريد حذف هذا الإعلان؟"))return;try{await api("/api/announcements/"+id,{method:"DELETE"});await loadAdminAnnouncements();await loadPublic();toast("تم حذف الإعلان.");}catch(e){toast(e.message);}}
async function renderFamily(){
 const d=await api("/api/teachers");teachersCache=d.teachers||[];
 $("#dashboardContent").innerHTML=`<div class="panel"><h3>الكادر التدريسي</h3><div class="staff-grid" id="familyTeachers"></div></div><div class="panel"><h3>رسائلي</h3><div id="messageList"></div></div>`;
 $("#familyTeachers").innerHTML=teachersCache.map(t=>`<article class="person-card"><div class="avatar">${esc(initials(t.name))}</div><div class="person-info"><h3>${esc(t.name)}</h3><p>${esc(t.subject||"مدرس")}</p><div class="person-actions">${t.whatsapp?`<a class="wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/${encodeURIComponent(t.whatsapp.replace(/^\+/,""))}">واتساب</a>`:""}${t.phone?`<a href="tel:${encodeURIComponent(t.phone)}">اتصال</a>`:""}<button onclick="renderMessages(${t.id},'${esc(t.name).replace(/'/g,"&#39;")}')">إرسال رسالة</button></div></div></article>`).join("")||'<div class="empty">لم تتم إضافة مدرسين بعد.</div>';
 await renderMessages();
}
async function renderMessages(recipientId=null,recipientName=""){
 if(!$("#dashboardContent"))return;
 if(!$("#messageList"))$("#dashboardContent").innerHTML=`<div class="panel"><h3>صندوق الرسائل</h3><div id="messageList"></div></div>`;
 const d=await api("/api/messages");const el=$("#messageList");if(!el)return;
 el.innerHTML=(d.messages||[]).map(m=>`<article class="message"><strong>${esc(m.sender_name)} ← ${esc(m.recipient_name)}</strong><p>${esc(m.body)}</p><small>${esc(m.created_at)} ${m.read_at?"· تمت القراءة":""}</small></article>`).join("")||'<div class="empty">لا توجد رسائل حتى الآن.</div>';
 if(currentUser.role==="family"){
   const options=teachersCache.map(t=>`<option value="${t.id}" ${recipientId===t.id?"selected":""}>${esc(t.name)}${t.subject?" — "+esc(t.subject):""}</option>`).join("");
   el.insertAdjacentHTML("beforeend",`<form id="messageForm" class="message-compose"><label>إرسال رسالة إلى مدرس<select name="recipient_id" required><option value="">اختر المدرس</option>${options}</select></label><label>نص الرسالة<textarea name="body" required maxlength="2000" placeholder="اكتب رسالتك هنا..."></textarea></label><button class="btn btn-primary" type="submit">إرسال الرسالة</button></form>`);
   $("#messageForm").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/messages",{method:"POST",body:JSON.stringify(data)});toast("تم إرسال الرسالة.");await renderMessages();}catch(err){toast(err.message);}});
 } else if(currentUser.role==="teacher"){
   el.insertAdjacentHTML("beforeend",`<form id="replyForm" class="message-compose"><label>رقم حساب الطالب / ولي الأمر<input name="recipient_id" type="number" required min="1" placeholder="رقم الحساب"></label><label>نص الرد<textarea name="body" required maxlength="2000"></textarea></label><button class="btn btn-primary" type="submit">إرسال الرد</button></form><p class="muted small">يعرض النظام رقم الحساب في لوحة إدارة الأشخاص. يمكن تطوير اختيار المستلم إلى قائمة أسماء في نسخة لاحقة.</p>`);
   $("#replyForm").addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/messages",{method:"POST",body:JSON.stringify(data)});toast("تم إرسال الرد.");await renderMessages();}catch(err){toast(err.message);}});
 }
}
async function boot(){
 try{const d=await api("/api/me");currentUser=d.user;updateAuthUI();await loadPublic();if(currentUser){showSection("dashboard");await renderDashboard();}}
 catch(e){await loadPublic();}
}
boot();
