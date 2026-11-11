// Protocolo candidato isolado: só é importado pela prova temporária, nunca pelo backend ativo.
import {QUOTE_HEADERS} from '../src/quote-sheets.mjs';
const MARKER_KEY='tq';
export const QUOTE_STATUS_FORMULA='=IF(INDEX(R:R,ROW())="","Pendente envio","Novo")';
export function quoteInsertRequests(sheetId,row,metadataId,reference){
  if(!Number.isInteger(sheetId)||sheetId<0||!Number.isInteger(metadataId)||metadataId<=0||metadataId>0x7fffffff
    ||!/^TS-[A-F0-9]{20}$/.test(reference)||!Array.isArray(row)||row.length!==QUOTE_HEADERS.length
    ||row.some(value=>typeof value!=='string'))throw Error('sheets_insert_invalid');
  const values=row.map(value=>({userEnteredValue:{stringValue:value}}));
  values[14]={userEnteredValue:{formulaValue:QUOTE_STATUS_FORMULA}};
  return [
    {insertDimension:{range:{sheetId,dimension:'ROWS',startIndex:1,endIndex:2},inheritFromBefore:false}},
    {updateCells:{start:{sheetId,rowIndex:1,columnIndex:0},rows:[{values}],fields:'userEnteredValue'}},
    {createDeveloperMetadata:{developerMetadata:{metadataId,metadataKey:MARKER_KEY,
      location:{dimensionRange:{sheetId,dimension:'ROWS',startIndex:1,endIndex:2}},visibility:'DOCUMENT'}}}
  ];
}
export function quoteRowFilter(metadataId){
  if(!Number.isInteger(metadataId)||metadataId<=0||metadataId>0x7fffffff)
    throw Error('sheets_metadata_invalid');
  return {developerMetadataLookup:{metadataId,metadataKey:MARKER_KEY,
    locationType:'ROW',visibility:'DOCUMENT'}};
}
