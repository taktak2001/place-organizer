import assert from "node:assert/strict";
import JSZip from "jszip";
import { classifyPlace } from "../lib/classification/category";
import { classifyRegion } from "../lib/classification/region";
import { googleMapsUrlForCoordinates, parseCoordinateText } from "../lib/import/coordinates";
import { computeDiffPreview } from "../lib/import/diff";
import { parseGoogleMapsUrl } from "../lib/import/google-maps-url";
import { computeNormalizedKey, duplicateCandidates } from "../lib/import/normalize";
import { parseCsvContent, parseImportFiles, parseJsonContent, parseZip } from "../lib/import/parsers";
import { hasUrlDifference, preferredGoogleMapsUrl } from "../lib/import/source-fields";

async function run() {
  const csv = "Title,URL,Address,Latitude,Longitude\nMuseum Alpha,https://maps.google.com/?q=Museum%20Alpha,東京都港区六本木1-1,35.66,139.73\n";
  const csvResult = parseCsvContent(csv, "保存済み/Art.csv");
  assert.equal(csvResult.items.length, 1);
  assert.equal(csvResult.items[0].source_list_name, "Art");
  assert.equal(csvResult.items[0].name, "Museum Alpha");

  const takeoutCsv = "タイトル,メモ,URL,タグ,コメント\nMuseum Delta,Note,https://maps.google.com/?q=Museum%20Delta,Art,Comment\n";
  const takeoutResult = parseCsvContent(takeoutCsv, "Art.csv");
  assert.equal(takeoutResult.items.length, 1);
  assert.equal(takeoutResult.errors.length, 0);
  assert.equal(takeoutResult.items[0].source_list_name, "Art");
  assert.equal(takeoutResult.items[0].google_maps_url, "https://maps.google.com/?q=Museum+Delta");

  const takeoutWithBlankRow = "タイトル,メモ,URL,タグ,コメント\n,,,,\nMuseum Delta,Note,https://maps.google.com/?q=Museum%20Delta,Art,Comment\n";
  const blankRowResult = parseCsvContent(takeoutWithBlankRow, "Art.csv");
  assert.equal(blankRowResult.items.length, 1);
  assert.equal(blankRowResult.errors.length, 0);
  assert.equal(blankRowResult.skipped_rows.length, 1);

  const multiResult = await parseImportFiles([
    new File([takeoutCsv], "Art.csv", { type: "text/csv" }),
    new File(["タイトル,メモ,URL,タグ,コメント\nCafe Epsilon,,https://maps.google.com/?q=Cafe%20Epsilon,Cafe,\n"], "Cafe.csv", { type: "text/csv" })
  ]);
  assert.equal(multiResult.items.length, 2);
  assert.deepEqual([...new Set(multiResult.items.map((item) => item.source_list_name))], ["Art", "Cafe"]);

  const geoJson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { title: "Cafe Beta", address: "東京都渋谷区恵比寿1-1", url: "https://maps.google.com/?q=Cafe%20Beta" },
        geometry: { type: "Point", coordinates: [139.71, 35.64] }
      }
    ]
  });
  const geoResult = parseJsonContent(geoJson, "Cafe.geojson");
  assert.equal(geoResult.items.length, 1);
  assert.equal(geoResult.items[0].longitude, 139.71);

  const json = JSON.stringify({ places: [{ placeName: "Bistro Gamma", address: "京都府京都市中京区", url: "https://maps.google.com/?q=Bistro" }] });
  const jsonResult = parseJsonContent(json, "Restaurant.json");
  assert.equal(jsonResult.items.length, 1);
  assert.equal(jsonResult.items[0].source_list_name, "Restaurant");

  const zip = new JSZip();
  zip.file("Takeout/保存済み/Art.csv", csv);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipResult = await parseZip(zipBuffer, "takeout.zip");
  assert.equal(zipResult.items.length, 1);

  const normalizedKey = computeNormalizedKey({ name: "Museum Alpha", address: "東京都港区六本木1-1" });
  assert.ok(normalizedKey.startsWith("addr:"));

  const duplicates = duplicateCandidates([csvResult.items[0], { ...csvResult.items[0], source_list_name: "行ってみたい" }]);
  assert.ok(duplicates.length >= 1);

  const classification = classifyPlace(csvResult.items[0]);
  assert.equal(classification.main_category, "Art");
  assert.equal(classification.sub_category, "Museum");

  const region = classifyRegion(csvResult.items[0]);
  assert.equal(region.country, "Japan");
  assert.equal(region.prefecture, "東京都");
  assert.equal(region.ward, "港区");
  assert.equal(region.area_label, "六本木");

  const regionCases = [
    { address: "〒600-8032 京都府京都市下京区中之町５６６", prefecture: "京都府", city: "京都市", ward: "下京区", area: "京都市下京区", travel: "京都" },
    { address: "京都府京都市左京区岡崎", prefecture: "京都府", city: "京都市", ward: "左京区", area: "京都市左京区", travel: "京都" },
    { address: "愛知県名古屋市中区栄", prefecture: "愛知県", city: "名古屋市", ward: "中区", area: "名古屋市中区", travel: "名古屋" },
    { address: "茨城県北茨城市", prefecture: "茨城県", city: "北茨城市", ward: null, area: "北茨城", travel: "北茨城" },
    { address: "東京都渋谷区", prefecture: "東京都", city: null, ward: "渋谷区", area: "渋谷", travel: "東京" },
    { address: "東京都港区六本木", prefecture: "東京都", city: null, ward: "港区", area: "六本木", travel: "東京" },
    { address: "神奈川県足柄下郡箱根町", prefecture: "神奈川県", city: "箱根町", ward: null, area: "箱根", travel: "箱根" },
    { address: "長野県北佐久郡軽井沢町", prefecture: "長野県", city: "軽井沢町", ward: null, area: "軽井沢", travel: "軽井沢" }
  ];

  for (const item of regionCases) {
    const result = classifyRegion({ ...csvResult.items[0], name: "Test", address: item.address, latitude: null, longitude: null, raw: {} });
    assert.equal(result.prefecture, item.prefecture);
    assert.equal(result.city, item.city);
    assert.equal(result.ward, item.ward);
    assert.equal(result.area_label, item.area);
    assert.equal(result.travel_region, item.travel);
  }

  const dmsCoordinates = parseCoordinateText("45°26'15.6\"N 12°20'26.5\"E");
  assert.ok(dmsCoordinates);
  assert.equal(Number(dmsCoordinates.latitude.toFixed(6)), 45.437667);
  assert.equal(Number(dmsCoordinates.longitude.toFixed(6)), 12.340694);
  assert.deepEqual(parseCoordinateText("45.437667, 12.340694"), { latitude: 45.437667, longitude: 12.340694 });
  assert.equal(googleMapsUrlForCoordinates({ latitude: 45.437667, longitude: 12.340694 }), "https://www.google.com/maps/search/?api=1&query=45.437667,12.340694");
  assert.equal(preferredGoogleMapsUrl({
    rawGoogle: { googleMapsUri: "https://maps.google.com/enriched" },
    placeGoogleMapsUrl: "https://maps.google.com/place",
    rawImport: { URL: "https://maps.google.com/source" },
    latitude: 45.437667,
    longitude: 12.340694
  }), "https://maps.google.com/source");
  assert.equal(hasUrlDifference("https://maps.google.com/source", "https://maps.google.com/enriched"), true);
  const mapsUrlInfo = parseGoogleMapsUrl("https://www.google.com/maps/place/Badiani+Gelato/@43.771,11.255,17z?query_place_id=ChIJTEST");
  assert.equal(mapsUrlInfo.place_id, "ChIJTEST");
  assert.equal(mapsUrlInfo.name_hint, "Badiani Gelato");
  assert.equal(mapsUrlInfo.latitude, 43.771);
  assert.equal(mapsUrlInfo.longitude, 11.255);

  const diff = computeDiffPreview(
    [csvResult.items[0], geoResult.items[0]],
    [{ normalized_key: csvResult.items[0].normalized_key, source_list_name: csvResult.items[0].source_list_name }]
  );
  assert.deepEqual(diff, { added: 1, removed: 0, unchanged: 1, list_added: 1, list_removed: 0 });

  const thousand = Array.from({ length: 1000 }, (_, index) => ({
    ...csvResult.items[0],
    name: `Place ${index}`,
    address: `東京都渋谷区${index}`,
    google_maps_url: `https://maps.google.com/?q=Place%20${index}`,
    normalized_key: `list:test:place${index}`
  }));
  assert.equal(duplicateCandidates(thousand).length, 0);
}

run()
  .then(() => {
    console.log("Import tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
