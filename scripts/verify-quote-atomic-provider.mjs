// Exercita a API real numa folha temporária oculta; não lê pedidos comerciais.
import {pathToFileURL} from 'node:url';
import {googleToken,QUOTE_SHEET_ID,QUOTE_HEADERS} from '../src/quote-sheets.mjs';
const ROOT='https://sheets.googleapis.com/v4/spreadsheets/'+QUOTE_SHEET_ID;
const allowed=env=>env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY_ID==='1452563434'
  &&env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'&&env.GITHUB_REF==='refs/heads/main';
const positiveID=()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);return (value[0]&0x7fffffff)||1;};
export async function verifyQuoteAtomicProvider({env=process.env,fetcher=fetch,authorize=googleToken,
  randomID=positiveID,uuid=()=>crypto.randomUUID()}={}){
  if(!allowed(env))return {verified:false,code:'atomic_probe_context_invalid'};
  let access,created=false,removed=false,sheetId,title;
  let result={verified:false,code:'atomic_probe_unavailable'};
  async function call(path,body){
    return fetcher(ROOT+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
  }
  try{
    access=await authorize(env,fetcher);sheetId=randomID();const markerId=randomID();
    title='TS-Teste-Atomic-'+uuid().slice(0,8);
    if(!Number.isInteger(sheetId)||sheetId<=0||sheetId>0x7fffffff||!Number.isInteger(markerId)||markerId<=0||markerId>0x7fffffff
      ||!/^TS-Teste-Atomic-[a-f0-9-]{8}$/.test(title))throw Error('atomic_probe_input_invalid');
    const setup=await call(':batchUpdate',{requests:[
      {addSheet:{properties:{sheetId,title,hidden:true,gridProperties:{rowCount:10,columnCount:18}}}},
      {updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:18},
        rows:[{values:QUOTE_HEADERS.map(value=>({userEnteredValue:{stringValue:value},userEnteredFormat:{
          backgroundColor:{red:0,green:0,blue:0},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}}))}],
        fields:'userEnteredValue,userEnteredFormat'}},
      {repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:10,startColumnIndex:0,endColumnIndex:18},
        cell:{userEnteredFormat:{backgroundColor:{red:1,green:1,blue:1},textFormat:{foregroundColor:{red:0,green:0,blue:0},bold:false}}},fields:'userEnteredFormat'}}
    ]});
    if(!setup.ok)throw Error('atomic_probe_setup_failed');
    const properties=(await setup.json()).replies?.[0]?.addSheet?.properties;
    if(properties?.sheetId!==sheetId||properties.title!==title)throw Error('atomic_probe_setup_unconfirmed');
    created=true;
    const cells=Array(18).fill('texto fictício');cells[0]='TS-TESTE-ATOMICIDADE';cells[1]='=1+1';
    const body={requests:[
      {createDeveloperMetadata:{developerMetadata:{metadataId:markerId,metadataKey:'tq',location:{sheetId},visibility:'DOCUMENT'}}},
      {appendCells:{sheetId,rows:[{values:cells.map(value=>({userEnteredValue:{stringValue:value}}))}],fields:'userEnteredValue'}}
    ]};
    const responses=await Promise.all([call(':batchUpdate',body),call(':batchUpdate',body)]);
    const statuses=responses.map(response=>response.status);
    if(statuses.filter(status=>status===200).length!==1||statuses.filter(status=>status===400).length!==1)
      throw Error('atomic_probe_uniqueness_failed');
    const range=encodeURIComponent("'"+title+"'!A1:R10");
    const valuesResponse=await call('/values/'+range);
    if(!valuesResponse.ok)throw Error('atomic_probe_read_failed');
    const values=(await valuesResponse.json()).values;
    if(!Array.isArray(values)||values.length!==2||JSON.stringify(values[1])!==JSON.stringify(cells))throw Error('atomic_probe_values_failed');
    const formatResponse=await call('?ranges='+encodeURIComponent("'"+title+"'!A2:B2")
      +'&includeGridData=true&fields=sheets(data(rowData(values(userEnteredValue,userEnteredFormat,effectiveFormat))))');
    if(!formatResponse.ok)throw Error('atomic_probe_format_read_failed');
    const formatted=(await formatResponse.json()).sheets?.[0]?.data?.[0]?.rowData?.[0]?.values;
    if(formatted?.[1]?.userEnteredValue?.stringValue!=='=1+1'||formatted[1].userEnteredValue.formulaValue)
      throw Error('atomic_probe_literal_failed');
    // Sheets pode omitir effectiveFormat quando coincide com a predefinição.
    const text=formatted?.[0]?.effectiveFormat?.textFormat?.foregroundColor
      ??formatted?.[0]?.userEnteredFormat?.textFormat?.foregroundColor;
    const background=formatted?.[0]?.effectiveFormat?.backgroundColor
      ??formatted?.[0]?.userEnteredFormat?.backgroundColor;
    const black=text&&(text.red||0)<0.05&&(text.green||0)<0.05&&(text.blue||0)<0.05;
    const white=background&&background.red>0.95&&background.green>0.95&&background.blue>0.95;
    if(!black||!white)throw Error('atomic_probe_format_changed');
    result={verified:true,statuses,uniqueRows:1,literalTextVerified:true,preservedFormatsVerified:true,code:'atomic_provider_verified'};
  }catch(error){
    result={verified:false,code:/^atomic_probe_[a-z_]+$/.test(error?.message||'')?error.message:'atomic_probe_unavailable'};
  }finally{
    if(created){
      try{const cleanup=await call(':batchUpdate',{requests:[{deleteSheet:{sheetId}}]});removed=cleanup.ok;}
      catch{removed=false;}
      if(!removed)result={verified:false,code:'atomic_probe_cleanup_pending'};
    }
  }
  return {...result,temporarySheetRemoved:removed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await verifyQuoteAtomicProvider();console.log(JSON.stringify(result,null,2));
  if(result.verified!==true)process.exitCode=1;
}
