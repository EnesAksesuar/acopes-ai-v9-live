const fs = require("fs");

const csv = fs.readFileSync("listing_rewrites.csv", "utf8").trim().split(/\r?\n/);
const rows = csv.slice(1).map((line) => {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  const [current_title, decision, new_title, description, tags, first_image_direction] = cells;
  return { current_title, decision, new_title, description, tags, first_image_direction };
});

function score(row) {
  let total = 0;
  const title = row.new_title.toLowerCase();
  const description = row.description.toLowerCase();
  const tags = row.tags.split("|");

  if (row.new_title.length <= 140) total += 10;
  if (/necklace|bracelet|jewelry/.test(title)) total += 10;
  if (/gift for her|everyday|quiet luxury|minimal/.test(title)) total += 15;
  if (tags.length === 13) total += 15;
  if (/gift|everyday|layer/.test(description)) total += 10;
  if (row.decision === "hero") total += 20;
  if (row.decision === "reframe") total += 10;
  if (row.first_image_direction.length > 15) total += 10;
  if (!/halloween|costume|streetwear|brooch|kitty|coffin/.test(title)) total += 10;

  return total;
}

const scored = rows
  .map((row) => ({ ...row, score: score(row) }))
  .sort((a, b) => b.score - a.score);

console.log("Top 15 priority listings");
for (const row of scored.slice(0, 15)) {
  console.log(`${row.score}\t${row.decision}\t${row.new_title}`);
}

console.log("\nQuarantine count");
console.log(scored.filter((row) => row.decision === "quarantine").length);

