// Exercita a API real numa folha temporária oculta; não lê pedidos comerciais.
import {pathToFileURL} from 'node:url';
import {googleToken,QUOTE_SHEET_ID,QUOTE_HEADERS} from '../src/quote-sheets.mjs';
import {QUOTE_STATUS_FORMULA,quoteInsertRequests,quoteRowFilter} from './quote-row-protocol.mjs';
const ROOT='https://sheets.googleapis.com/v4/spreadsheets/'+QUOTE_SHEET_ID;
const allowed=env=>env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY_ID==='1452563434'
  &&env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'&&env.GITHUB_REF==='refs/heads/main';
const positiveID=()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);return (value[0]&0x7fffffff)||1;};
const REF_A='TS-00000000000000000001',REF_B='TS-FFFFFFFFFFFFFFFFFFFF';
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
  async function values(){
    const response=await call('/values/'+encodeURIComponent("'"+title+"'!A1:R10"));
    if(!response.ok)throw Error('atomic_probe_read_failed');
    const all=(await response.json()).values;
    if(!Array.isArray(all)||JSON.stringify(all[0])!==JSON.stringify(QUOTE_HEADERS))throw Error('atomic_probe_values_failed');
    return all;
  }
  async function assertAnchor(id,index,code){
    const response=await call('/developerMetadata/'+id);
    if(!response.ok)throw Error(code);
    const marker=await response.json(),range=marker?.location?.dimensionRange;
    if(marker.metadataId!==id||marker.metadataKey!=='tq'||marker.metadataValue
      ||marker.visibility!=='DOCUMENT'||range?.sheetId!==sheetId||range.dimension!=='ROWS'
      ||range.startIndex!==index||range.endIndex!==index+1)throw Error(code);
  }
  async function writeStatus(filter,providerId){
    const row=Array(18).fill(null);row[16]='2026-11-11T00:00:00.000Z';row[17]=providerId;
    const response=await call('/values:batchUpdateByDataFilter',{valueInputOption:'RAW',data:[{
      dataFilter:filter,majorDimension:'ROWS',values:[row]
    }]});
    if(!response.ok)throw Error('atomic_probe_filter_write_failed');
    const updated=await response.json();
    if(updated.totalUpdatedRows!==1||updated.totalUpdatedCells!==2)throw Error('atomic_probe_null_skip_failed');
  }
  try{
    access=await authorize(env,fetcher);sheetId=randomID();const markerId=randomID(),otherMarkerId=randomID();
    title='TS-Teste-Atomic-'+uuid().slice(0,8);
    if([sheetId,markerId,otherMarkerId].some(id=>!Number.isInteger(id)||id<=0||id>0x7fffffff)
      ||markerId===otherMarkerId||!/^TS-Teste-Atomic-[a-f0-9-]{8}$/.test(title))throw Error('atomic_probe_input_invalid');
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
    const cells=Array(18).fill('texto fictício');cells[0]=REF_A;cells[1]='=1+1';cells[14]='Pendente envio';cells[17]='';
    const body={requests:quoteInsertRequests(sheetId,cells,markerId,REF_A)};
    const responses=await Promise.all([call(':batchUpdate',body),call(':batchUpdate',body)]);
    const statuses=responses.map(response=>response.status);
    if(statuses.filter(status=>status===200).length!==1||statuses.filter(status=>status===400).length!==1)
      throw Error('atomic_probe_uniqueness_failed');
    const initial=await values();
    if(initial.length!==2||JSON.stringify(initial[1])!==JSON.stringify(cells.slice(0,17)))throw Error('atomic_probe_values_failed');
    const other=[...cells];other[0]=REF_B;other[1]='outro texto fictício';
    const second=await call(':batchUpdate',{requests:quoteInsertRequests(sheetId,other,otherMarkerId,REF_B)});
    if(!second.ok)throw Error('atomic_probe_second_row_failed');
    await assertAnchor(markerId,2,'atomic_probe_insert_anchor_failed');
    const sorted=await call(':batchUpdate',{requests:[{sortRange:{range:{sheetId,startRowIndex:1,endRowIndex:3,startColumnIndex:0,endColumnIndex:18},sortSpecs:[{dimensionIndex:0,sortOrder:'ASCENDING'}]}}]});
    if(!sorted.ok)throw Error('atomic_probe_sort_failed');
    await assertAnchor(markerId,1,'atomic_probe_sort_anchor_failed');
    const before=await values();
    if(before.length!==3||before[1][0]!==REF_A||before[2][0]!==REF_B)throw Error('atomic_probe_sort_values_failed');
    const filter=quoteRowFilter(markerId);
    const filteredResponse=await call('/values:batchGetByDataFilter',{dataFilters:[filter],majorDimension:'ROWS'});
    if(!filteredResponse.ok)throw Error('atomic_probe_filter_read_failed');
    const filtered=(await filteredResponse.json()).valueRanges;
    if(filtered?.length!==1||filtered[0].valueRange?.values?.length!==1
      ||filtered[0].valueRange.values[0][0]!==REF_A||filtered[0].dataFilters?.length!==1
      ||Object.entries(filter.developerMetadataLookup).some(([key,value])=>filtered[0].dataFilters[0].developerMetadataLookup?.[key]!==value))throw Error('atomic_probe_filter_read_failed');
    await writeStatus(filter,'synthetic-provider-one');
    const after=await values();
    if(after[1][14]!=='Novo'||after[1][17]!=='synthetic-provider-one'
      ||JSON.stringify(after[2])!==JSON.stringify(before[2]))throw Error('atomic_probe_filter_target_failed');
    for(let column=0;column<18;column++)if(![14,16,17].includes(column)
      &&after[1][column]!==before[1][column])throw Error('atomic_probe_null_skip_failed');
    const formatResponse=await call('?ranges='+encodeURIComponent("'"+title+"'!A2:R2")
      +'&includeGridData=true&fields=sheets(data(rowData(values(userEnteredValue,userEnteredFormat,effectiveFormat))))');
    if(!formatResponse.ok)throw Error('atomic_probe_format_read_failed');
    const formatted=(await formatResponse.json()).sheets?.[0]?.data?.[0]?.rowData?.[0]?.values;
    if(formatted?.[1]?.userEnteredValue?.stringValue!=='=1+1'||formatted[1].userEnteredValue.formulaValue)
      throw Error('atomic_probe_literal_failed');
    if(formatted?.[14]?.userEnteredValue?.formulaValue!==QUOTE_STATUS_FORMULA)throw Error('atomic_probe_formula_failed');
    const text=formatted?.[0]?.effectiveFormat?.textFormat?.foregroundColor
      ??formatted?.[0]?.userEnteredFormat?.textFormat?.foregroundColor;
    const background=formatted?.[0]?.effectiveFormat?.backgroundColor
      ??formatted?.[0]?.userEnteredFormat?.backgroundColor;
    const black=text&&(text.red||0)<0.05&&(text.green||0)<0.05&&(text.blue||0)<0.05;
    const white=background&&background.red>0.95&&background.green>0.95&&background.blue>0.95;
    if(!black||!white)throw Error('atomic_probe_format_changed');
    const manual=await call('/values:batchUpdate',{valueInputOption:'RAW',data:[{range:"'"+title+"'!O2",values:[['Em análise']]}]});
    if(!manual.ok)throw Error('atomic_probe_manual_status_failed');
    const resorted=await call(':batchUpdate',{requests:[{sortRange:{range:{sheetId,startRowIndex:1,endRowIndex:3,startColumnIndex:0,endColumnIndex:18},sortSpecs:[{dimensionIndex:0,sortOrder:'DESCENDING'}]}}]});
    if(!resorted.ok)throw Error('atomic_probe_sort_failed');
    await assertAnchor(markerId,2,'atomic_probe_sort_anchor_failed');
    await writeStatus(filter,'synthetic-provider-two');
    const preserved=await values();
    if(preserved[2][0]!==REF_A||preserved[2][14]!=='Em análise'||preserved[2][17]!=='synthetic-provider-two'
      ||JSON.stringify(preserved[1])!==JSON.stringify(before[2]))throw Error('atomic_probe_manual_status_failed');
    result={verified:true,statuses,uniqueRows:1,literalTextVerified:true,preservedFormatsVerified:true,
      rowAnchorMovesVerified:true,sortAnchorMovesVerified:true,metadataDataFilterVerified:true,
      nullSkipVerified:true,manualStatusPreserved:true,code:'atomic_provider_verified'};
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
