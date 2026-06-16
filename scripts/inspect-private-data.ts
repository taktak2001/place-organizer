import { readPrivateCsvData, summarizePrivateData } from "./private-data";

const data = readPrivateCsvData();
console.log(JSON.stringify(summarizePrivateData(data), null, 2));
