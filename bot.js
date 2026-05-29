require("dotenv").config();

const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");

const WORLD = "pl228";
const TARGET_ALLY_TAGS = ["LN", "LN.", "LN!"];

const CHANNELS = {
  farm: process.env.FARM_CHANNEL_ID,
  attack: process.env.ATTACK_CHANNEL_ID,
  defense: process.env.DEFENSE_CHANNEL_ID,
  all: process.env.ALL_CHANNEL_ID
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log("Bot zalogowany jako " + client.user.tag);

 await wyslijRankingFarmiacych();
  await wyslijRankingMapowy("attack");
  await wyslijRankingMapowy("defense");
  await wyslijRankingMapowy("all");

  ustawCodzienneRankingi();
});

function ustawCodzienneRankingi() {
  setInterval(async () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();

    if (h === 0 && m === 10) await wyslijRankingFarmiacych();
    if (h === 0 && m === 15) await wyslijRankingMapowy("attack");
    if (h === 0 && m === 20) await wyslijRankingMapowy("defense");
    if (h === 0 && m === 25) await wyslijRankingMapowy("all");
  }, 60 * 1000);
}

async function wyslijRankingFarmiacych() {
  const channel = await client.channels.fetch(CHANNELS.farm);
  const top = await pobierzTopFarmiacych(20);

  if (!top.length) {
    console.log("Brak danych farmerów.");
    return;
  }

  dodajZmianyPozycji(top, "./farm-ranking-history.json");

  const lider = top[0];
  const awans = znajdzNajwiekszyAwans(top);

  const content =
    "🌾 **TOP 20 Farmerów farmiących dziennie z Rodziny Plemion LN** 🌾\n" +
    formatujRanking(top, true) +
    "\n👑 **Farmer dnia:** " +
    `${lider.name} [${lider.allyTag}] - ${formatNumber(lider.value)} - ${lider.date}` +
    "\n📈 **Największy awans:** " +
    (awans ? `${awans.name} [${awans.allyTag}] - ▲${awans.awans}` : "brak awansów");

  await channel.send(content);
  zapiszRanking(top, "./farm-ranking-history.json");

  console.log("Wysłano ranking farmerów.");
}

async function wyslijRankingMapowy(type) {
  const config = {
    attack: {
      file: "kill_att.txt",
      channel: CHANNELS.attack,
      history: "./attack-ranking-history.json",
      title: "⚔️ **TOP 20 Atakujących z Rodziny Plemion LN** ⚔️",
      leader: "Atakujący dnia"
    },
    defense: {
      file: "kill_def.txt",
      channel: CHANNELS.defense,
      history: "./defense-ranking-history.json",
      title: "🛡️ **TOP 20 Obrońców z Rodziny Plemion LN** 🛡️",
      leader: "Obrońca dnia"
    },
    all: {
      file: "kill_all.txt",
      channel: CHANNELS.all,
      history: "./all-ranking-history.json",
      title: "🏆 **TOP 20 RA z Rodziny Plemion LN** 🏆",
      leader: "RA dnia"
    }
  }[type];

  const channel = await client.channels.fetch(config.channel);
  const top = await pobierzTopMapowy(config.file, 20);

  if (!top.length) {
    console.log("Brak danych rankingu: " + type);
    return;
  }

  dodajZmianyPozycji(top, config.history);

  const lider = top[0];
  const awans = znajdzNajwiekszyAwans(top);

  const content =
    config.title + "\n" +
    formatujRanking(top, false) +
    "\n👑 **" + config.leader + ":** " +
    `${lider.name} [${lider.allyTag}] - ${formatNumber(lider.value)}` +
    "\n📈 **Największy awans:** " +
    (awans ? `${awans.name} [${awans.allyTag}] - ▲${awans.awans}` : "brak awansów");

  await channel.send(content);
  zapiszRanking(top, config.history);

  console.log("Wysłano ranking: " + type);
}

async function pobierzTopFarmiacych(limit) {
  const wynik = [];

  for (let offset = 0; offset <= 300; offset += 25) {
    const url =
      `https://${WORLD}.plemiona.pl/guest.php?village=null&screen=ranking&mode=in_a_day&type=loot_res&offset=${offset}`;

    console.log("Farm offset " + offset);

    const res = await fetch(url);
    if (!res.ok) break;

    const html = await res.text();
    const rows = parsujRankingFarmienia(html);

    for (const row of rows) {
      if (TARGET_ALLY_TAGS.includes(row.allyTag) && wynik.length < limit) {
        wynik.push(row);
      }
    }

    console.log("Znaleziono farmerów LN: " + wynik.length + "/" + limit);

    if (wynik.length >= limit) break;

    await sleep(randomInt(3000, 8000));
  }

  return wynik.slice(0, limit);
}

async function pobierzTopMapowy(fileName, limit) {
  const base = `https://${WORLD}.plemiona.pl/map/`;

  const [allyText, playerText, rankingText] = await Promise.all([
    fetch(base + "ally.txt").then(r => r.text()),
    fetch(base + "player.txt").then(r => r.text()),
    fetch(base + fileName).then(r => r.text())
  ]);

  const allyMap = parseAllyMap(allyText);
  const playerMap = parsePlayerMap(playerText);
  const rankingMap = parseRankingMap(rankingText);

  const players = [];

  Object.keys(playerMap).forEach(playerId => {
    const p = playerMap[playerId];
    const allyTag = allyMap[p.allyId];

    if (TARGET_ALLY_TAGS.includes(allyTag)) {
      players.push({
        name: p.name,
        allyTag,
        value: rankingMap[playerId] || 0
      });
    }
  });

  return players
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function parsujRankingFarmienia(html) {
  const rows = [];

  html = String(html)
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ");

  const trRegex = /<tr[^>]*>(.*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const tr = trMatch[1];

    const tdMatches = [];
    const tdRegex = /<td[^>]*>(.*?)<\/td>/gi;
    let tdMatch;

    while ((tdMatch = tdRegex.exec(tr)) !== null) {
      tdMatches.push(czyscHtml(tdMatch[1]));
    }

    if (tdMatches.length < 5) continue;

    const name = tdMatches[1];
    const allyTag = tdMatches[2];
    const value = parseInt(tdMatches[3].replace(/[^0-9]/g, ""), 10);
    const date = tdMatches[4].replace(/\.20\d{2}/, "");

    if (name && allyTag && !isNaN(value)) {
      rows.push({ name, allyTag, value, date });
    }
  }

  return rows;
}

function parseAllyMap(data) {
  const map = {};

  data.split("\n").forEach(line => {
    if (!line.trim()) return;

    const p = line.split(",");
    if (p.length < 3) return;

    const allyId = String(p[0]).trim();
    const tag = decodeURIComponent(p[2].replace(/\+/g, " ")).trim();

    map[allyId] = tag;
  });

  return map;
}

function parsePlayerMap(data) {
  const map = {};

  data.split("\n").forEach(line => {
    if (!line.trim()) return;

    const p = line.split(",");
    if (p.length < 3) return;

    const id = String(p[0]).trim();
    const name = decodeURIComponent(p[1].replace(/\+/g, " ")).trim();
    const allyId = String(p[2]).trim();

    map[id] = { name, allyId };
  });

  return map;
}

function parseRankingMap(data) {
  const map = {};

  data.split("\n").forEach(line => {
    if (!line.trim()) return;

    const p = line.split(",");
    if (p.length < 3) return;

    const playerId = String(p[1]).trim();
    const value = parseInt(String(p[2]).replace(/[^0-9]/g, ""), 10);

    map[playerId] = isNaN(value) ? 0 : value;
  });

  return map;
}

function dodajZmianyPozycji(list, file) {
  const oldList = wczytajRanking(file);
  const oldPositions = {};

  oldList.forEach((p, i) => {
    oldPositions[p.name + "|" + p.allyTag] = i + 1;
  });

  list.forEach((p, i) => {
    const currentPos = i + 1;
    const key = p.name + "|" + p.allyTag;
    const oldPos = oldPositions[key];

    if (!oldPos) {
      p.change = "NEW";
      p.awans = 0;
    } else if (oldPos > currentPos) {
      p.awans = oldPos - currentPos;
      p.change = "▲" + p.awans;
    } else if (oldPos < currentPos) {
      p.awans = 0;
      p.change = "▼" + (currentPos - oldPos);
    } else {
      p.awans = 0;
      p.change = "-";
    }
  });
}

function znajdzNajwiekszyAwans(list) {
  let best = null;

  for (const p of list) {
    if (p.awans && p.awans > 0) {
      if (!best || p.awans > best.awans) {
        best = p;
      }
    }
  }

  return best;
}

function formatujRanking(list, showDate) {
  let text = "```\n";

  list.forEach((p, i) => {
    let name = p.name;

    if (name.length > 16) {
      name = name.substring(0, 13) + "...";
    }

    const place = String(i + 1).padStart(2, " ");
    const line = place + ". " + name + " [" + p.allyTag + "]";
    const points = formatNumber(p.value);
    const change = p.change || "-";
    const date = showDate ? " " + (p.date || "") : "";

    text +=
      line.padEnd(32, " ") +
      points.padStart(10, " ") +
      " " +
      change.padEnd(4, " ") +
      date +
      "\n";
  });

  return text + "```";
}

function czyscHtml(text) {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wczytajRanking(file) {
  if (!fs.existsSync(file)) return [];

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function zapiszRanking(list, file) {
  const simple = list.map(p => ({
    name: p.name,
    allyTag: p.allyTag
  }));

  fs.writeFileSync(file, JSON.stringify(simple, null, 2), "utf8");
}

function formatNumber(value) {
  return Number(value).toLocaleString("pl-PL");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(process.env.DISCORD_TOKEN);