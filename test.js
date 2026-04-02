const { GoogleSpreadsheet } = require("google-spreadsheet");

const creds = require("./bustling-kayak-457622-h9-2cd0120f373b.json");

const SHEET_ID = "1oV_AF6ZQOTsK2Cew4tGqn_dAa-Ro7chbrete12Ay-6c";

async function test() {

  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  console.log("Sheet title:", doc.title);

  const sheet = doc.sheetsByTitle["v2"];
  const rows = await sheet.getRows();

  console.log("Total rows:", rows.length);

  rows.forEach(r => {
    console.log(r.Title, r["Start Time"], r["End Time"]);
  });
}

test();