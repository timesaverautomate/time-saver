import os, json, re, unicodedata, requests, time
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SID="1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"
CITIES=[("Porto",41.1579,-8.6291),("Lisboa",38.7223,-9.1393),("Braga",41.5454,-8.4265),("Coimbra",40.2033,-8.4103),("Aveiro",40.6405,-8.6538),("Faro",37.0194,-7.9304)]
def norm(s):
 return "".join(c for c in unicodedata.normalize("NFKD",str(s or "").lower()) if not unicodedata.combining(c)).strip()
def main():
 creds=service_account.Credentials.from_service_account_info(json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]),scopes=["https://www.googleapis.com/auth/spreadsheets"])
 creds.refresh(Request())
 url="https://sheets.googleapis.com/v4/spreadsheets/"+SID+"/values/Empresas%21A1%3AZ10000"
 r=requests.get(url,headers={"Authorization":"Bearer "+creds.token},timeout=30);r.raise_for_status()
 rows=r.json().get("values",[])
 if not rows or rows[0][:5]!=["Empresa","Setor","Localidade","Website","Email comercial"]:raise RuntimeError("CRM: cabeçalhos inesperados")
 names={norm(x[0]) for x in rows[1:] if x}
 emails={norm(x[4]) for x in rows[1:] if len(x)>4}
 new=[]
 successful_queries=0
 failed_queries=0
 for city,lat,lon in CITIES:
  if len(new)>=30:break
  q='[out:json][timeout:40];(nwr(around:12000,'+str(lat)+','+str(lon)+')["shop"~"^(computer|electronics|mobile_phone|office_supplies|hardware|pet|furniture)$"]["name"];);out tags 250;'
  elements=None
  for endpoint in ("https://overpass.private.coffee/api/interpreter","https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"):
   try:
    r=requests.post(endpoint,data={"data":q},headers={"User-Agent":"TimeSaverAutomation/1.0 public-business-research"},timeout=65)
    if r.status_code!=200:
     print("Fonte",endpoint,"cidade",city,"HTTP",r.status_code)
     continue
    data=r.json()
    if "elements" not in data:
     print("Resposta inesperada de",endpoint,"em",city)
     continue
    elements=data["elements"]
    successful_queries+=1
    break
   except (requests.RequestException,ValueError) as exc:
    print("Fonte",endpoint,"cidade",city,"erro",type(exc).__name__)
  if elements is None:
   failed_queries+=1
   print("Todas as fontes indisponíveis em",city)
   continue
  time.sleep(1)
  for e in elements:
   t=e.get("tags",{});name=t.get("name","").strip();mail=(t.get("contact:email") or t.get("email") or "").split(";")[0].strip().lower()
   if not name or not re.fullmatch(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}",mail):continue
   if mail.split("@")[0] not in {"info","geral","contacto","comercial","office","hello","sales","contact","admin"}:continue
   if norm(name) in names or norm(mail) in emails:continue
   x=[""]*26;x[0]=name;x[1]=t.get("shop","Empresa");x[2]=city;x[3]=t.get("website") or t.get("contact:website") or "";x[4]=mail;x[5]=t.get("phone") or t.get("contact:phone") or ""
   x[7]="Investigar oportunidades de automação";x[8]="Por avaliar";x[9]="Por contactar";x[11]="Validar antes de contactar"
   x[15]="https://www.openstreetmap.org/"+e["type"]+"/"+str(e["id"]);x[16]="OSM público; não verificado";x[23]="Por avaliar";x[24]="Não";x[25]="osm:"+e["type"]+":"+str(e["id"])
   new.append(x);names.add(norm(name));emails.add(norm(mail))
   if len(new)>=30:break
 print("Consultas com sucesso:",successful_queries,"; falhas:",failed_queries)
 print("Candidatos encontrados:",len(new))
 if successful_queries==0:
  raise RuntimeError("Pesquisa falhou em todas as cidades; verificar HTTP e fontes Overpass. Nenhum contacto foi guardado.")
 if os.getenv("DRY_RUN","true")!="false":
  print("SIMULAÇÃO: nenhuma escrita e nenhum envio de email");return
 if new:
  a=requests.post("https://sheets.googleapis.com/v4/spreadsheets/"+SID+"/values/Empresas%21A%3AZ:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",headers={"Authorization":"Bearer "+creds.token},json={"values":new},timeout=30);a.raise_for_status()
  print("Contactos adicionados:",len(new))
 print("Nenhum email enviado")
if __name__=="__main__":main()
