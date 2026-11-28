const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.getItem("cp_token") || "";
let currentUser = null, activeKind = "", allTitles = [], authMode = "login", editingId = null;
const fallbackPoster = "https://images.unsplash.com/photo-1489599849927-2ee91c9b7c2d?auto=format&fit=crop&w=600&q=80";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(url,{...options,headers});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "حدث خطأ، حاول مرة أخرى.");
  return data;
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function showModal(id){$("#"+id).classList.remove("hidden")}
function closeModals(){$$(".modal").forEach(m=>m.classList.add("hidden"))}
$$("[data-close]").forEach(x=>x.addEventListener("click",closeModals));
function card(t){return `<article class="movie-card" data-id="${t.id}">
 <div class="poster-wrap"><img loading="lazy" src="${esc(t.poster||fallbackPoster)}" onerror="this.src='${fallbackPoster}'" alt="${esc(t.title)}">
 <span class="rating">★ ${Number(t.rating||0).toFixed(1)}</span><span class="kind-tag">${t.kind==="movie"?"فيلم":"مسلسل"}</span>
 <button class="favorite-toggle" data-fav="${t.id}" aria-label="إضافة للمفضلة">♡</button></div>
 <div class="card-info"><h3>${esc(t.title)}</h3><p>${esc(t.category||"أخرى")} · ${esc(t.year||"—")} · ${esc(t.country||"")}</p></div></article>`}
async function loadCategories(){try{const {categories}=await api("/api/categories");$("#category").innerHTML='<option value="">كل التصنيفات</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")}catch{}}
async function loadTitles(){
  const q=$("#search").value.trim(), category=$("#category").value, sort=$("#sort").value;
  const p=new URLSearchParams({q,sort});if(activeKind)p.set("kind",activeKind);if(category)p.set("category",category);
  $("#grid").innerHTML='<div class="loading">جاري تحميل المحتوى...</div>';
  try{
    const {titles}=await api("/api/titles?"+p.toString());allTitles=titles;
    $("#grid").innerHTML=titles.map(card).join("");$("#empty").classList.toggle("hidden",titles.length>0);
    if(!titles.length)$("#grid").innerHTML="";
    $$(".movie-card").forEach(c=>c.addEventListener("click",e=>{if(e.target.closest("[data-fav]"))return;openDetail(c.dataset.id)}));
    $$("[data-fav]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();toggleFavorite(b.dataset.fav,b)}));
  }catch(e){$("#grid").innerHTML=`<p class="empty">${esc(e.message)}</p>`}
}
async function openDetail(id){
  try{
    const {title:t}=await api("/api/titles/"+id);
    $("#detailContent").innerHTML=`<div class="detail-cover" style="background-image:url('${esc(t.backdrop||t.poster||fallbackPoster)}')"></div>
    <div class="detail-body"><span class="eyebrow">${t.kind==="movie"?"فيلم":"مسلسل"} · CINEMA PLUS</span><h2>${esc(t.title)}</h2>
    <div class="detail-meta">★ ${Number(t.rating||0).toFixed(1)} &nbsp; | &nbsp; ${esc(t.year||"")} &nbsp; | &nbsp; ${esc(t.country||"")} &nbsp; | &nbsp; ${esc(t.category||"")}</div>
    <p>${esc(t.description||"لا يوجد وصف متاح حاليًا.")}</p><div class="detail-actions">
    ${t.watch_url?`<a class="primary" target="_blank" rel="noopener noreferrer" href="${esc(t.watch_url)}">▶ مشاهدة عبر المصدر المرخص</a>`:""}
    ${t.download_url?`<a class="outline" target="_blank" rel="noopener noreferrer" href="${esc(t.download_url)}">↓ رابط التحميل المصرح</a>`:""}
    <button class="outline" id="detailFav">♡ أضف إلى قائمتي</button></div></div>`;
    $("#detailFav").onclick=()=>toggleFavorite(id,$("#detailFav"));
    showModal("detailModal");
    if(token)api("/api/history/"+id,{method:"POST"}).catch(()=>{});
  }catch(e){toast(e.message)}
}
async function toggleFavorite(id,button){
  if(!token){toast("سجّل الدخول لاستخدام قائمتك.");openAuth();return}
  try{const {favorite}=await api("/api/favorites/"+id,{method:"POST"});if(button)button.classList.toggle("on",favorite);toast(favorite?"تمت الإضافة إلى قائمتك":"تم الحذف من قائمتك")}catch(e){toast(e.message)}
}
function openAuth(){authMode="login";renderAuth();showModal("authModal")}
function renderAuth(){
  $("#authTitle").textContent=authMode==="login"?"أهلاً بعودتك":"أنشئ حسابك";
  $("#authSub").textContent=authMode==="login"?"سجّل دخولك لمتابعة قائمتك.":"انضم إلى CINEMA PLUS واحفظ اختياراتك.";
  $("#nameField").classList.toggle("hidden",authMode==="login");
  $("#authForm [name=password]").autocomplete=authMode==="login"?"current-password":"new-password";
  $("#authSubmit").textContent=authMode==="login"?"تسجيل الدخول":"إنشاء الحساب";
  $("#switchAuth").innerHTML=authMode==="login"?'ليس لديك حساب؟ <button>إنشاء حساب</button>':'لديك حساب بالفعل؟ <button>تسجيل الدخول</button>';
  $("#switchAuth button").onclick=()=>{authMode=authMode==="login"?"register":"login";renderAuth()};
  $("#authError").textContent="";
}
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());
  try{
    const data=await api("/api/auth/"+authMode,{method:"POST",body:JSON.stringify(body)});
    token=data.token;currentUser=data.user;localStorage.setItem("cp_token",token);closeModals();updateAccount();toast("أهلاً بك في CINEMA PLUS");
  }catch(err){$("#authError").textContent=err.message}
});
function updateAccount(){
  const b=$("#accountBtn");
  if(currentUser){b.textContent=currentUser.name.split(" ")[0];b.onclick=()=>{if(currentUser.role==="admin")openAdmin();else if(confirm("هل تريد تسجيل الخروج؟"))logout()};}
  else{b.textContent="دخول";b.onclick=openAuth}
}
function logout(){token="";currentUser=null;localStorage.removeItem("cp_token");updateAccount();toast("تم تسجيل الخروج")}
async function initUser(){if(!token){updateAccount();return}try{const d=await api("/api/me");currentUser=d.user;updateAccount()}catch{logout()}}
async function showFavorites(){
  if(!token){openAuth();return}
  try{const {titles}=await api("/api/favorites");$("#sectionTitle").innerHTML="قائمتي <em>المفضلة</em>";$("#grid").innerHTML=titles.map(card).join("");$("#empty").classList.toggle("hidden",titles.length>0);$("#catalog").scrollIntoView();$$(".movie-card").forEach(c=>c.onclick=()=>openDetail(c.dataset.id))}catch(e){toast(e.message)}
}
async function openAdmin(){
  if(!currentUser||currentUser.role!=="admin"){toast("هذه الخاصية للمدير فقط.");return}
  showModal("adminModal");$("#titleForm").reset();$("#titleForm [name=id]").value="";editingId=null;await loadAdminList();
}
async function loadAdminList(){
  try{const {titles}=await api("/api/admin/titles");$("#adminList").innerHTML=titles.map(t=>`<div class="admin-row"><span>${esc(t.title)} <small>(${t.kind==="movie"?"فيلم":"مسلسل"})</small></span><span><button data-edit="${t.id}">تعديل</button> <button class="delete" data-delete="${t.id}">حذف</button></span></div>`).join("");
    $$("[data-edit]").forEach(b=>b.onclick=()=>editTitle(titles.find(t=>t.id===Number(b.dataset.edit))));
    $$("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("تأكيد حذف هذا المحتوى؟")){await api("/api/admin/titles/"+b.dataset.delete,{method:"DELETE"});await loadAdminList();await loadTitles();toast("تم الحذف")}})
  }catch(e){$("#adminError").textContent=e.message}
}
function editTitle(t){
  const f=$("#titleForm");editingId=t.id;
  for(const [k,v] of Object.entries(t)){const el=f.elements[k];if(el){if(el.type==="checkbox")el.checked=!!v;else el.value=v??""}}
  f.scrollIntoView({behavior:"smooth",block:"start"});
}
$("#titleForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget,fd=new FormData(f),body=Object.fromEntries(fd.entries());body.featured=fd.has("featured");
  try{await api(editingId?"/api/admin/titles/"+editingId:"/api/admin/titles",{method:editingId?"PUT":"POST",body:JSON.stringify(body)});f.reset();editingId=null;f.elements.id.value="";await loadAdminList();await loadTitles();await loadCategories();toast("تم حفظ المحتوى بنجاح")}catch(err){$("#adminError").textContent=err.message}
});
$("#favoritesBtn").onclick=showFavorites;
$("#heroFeatured").onclick=()=>{activeKind="";$("#search").value="";loadTitles();$("#catalog").scrollIntoView()};
$("#search").addEventListener("input",()=>loadTitles());$("#category").addEventListener("change",loadTitles);$("#sort").addEventListener("change",loadTitles);
$$("[data-kind]").forEach(a=>a.addEventListener("click",()=>{activeKind=a.dataset.kind;$$("[data-kind]").forEach(x=>x.classList.toggle("active",x===a));$$(".chip").forEach(x=>x.classList.toggle("selected",x.dataset.filter===activeKind));loadTitles()}));
$$(".chip").forEach(b=>b.addEventListener("click",()=>{activeKind=b.dataset.filter;$$(".chip").forEach(x=>x.classList.toggle("selected",x===b));loadTitles()}));
$("#yearNow").textContent=new Date().getFullYear();
(async()=>{await initUser();await loadCategories();await loadTitles()})();
