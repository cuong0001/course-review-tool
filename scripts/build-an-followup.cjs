#!/usr/bin/env node
/*
 * Builds review-pages/an-followup.html: one page with only the items An has not finished
 * (exports of 2026-11-24, minus the three resources Khánh approved later).
 * Content is read from the course project at build time, so An reviews the current version,
 * including the fixes made after An's notes.
 *
 * Usage: node scripts/build-an-followup.cjs "PATH_TO/Computational-Thinking-Project"
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const project = process.argv[2];
if (!project || !fs.existsSync(path.join(project, 'data', 'curated'))) {
  console.error('Pass the course project folder (the one that contains data/curated).');
  process.exit(1);
}

const CHECKED = '2026-11-25';
const LINK_OK = `Automatic check on ${CHECKED}: the link opens and the cited section exists on the page.`;
const PENDING = {
  dsa: { name: 'Data Structures and Algorithms', dir: 'data/curated', items: [
    ['question', 'Q_T05_1_05', 'You flagged a possible int overflow of j. The stem now limits n to 1000000, so j += i cannot overflow. Check the new stem.'],
  ] },
  oop: { name: 'Object-Oriented Programming (CSC10003)', dir: 'data/courses/CSC10003', items: [
    ['lesson', 'lesson_OOP_T06_2', 'You asked for "read and validate each row separately". The section "complete" now reads each line with std::getline and parses it on its own.'],
    ...'T00_2_02 T00_3_02 T00_3_08 T01_1_06 T01_1_08 T02_1_01 T02_2_01 T02_3_03 T03_1_02 T03_1_04 T03_2_02 T04_1_01 T04_1_07 T04_2_02 T04_3_01 T04_3_03 T05_1_02 T05_1_03 T05_2_03 T06_1_06 T06_1_12 T06_2_06 T07_1_01 T07_3_01 T08_1_06 T08_1_12 T09_1_02 T10_1_02 T10_1_06 T10_2_02 T11_1_02 T12_1_01 T12_2_03'
      .split(' ').map(t => ['resource', `RES_OOP_${t}`, '']),
  ] },
  cn: { name: 'Computer Networking (CSC10008)', dir: 'data/courses/CSC10008', items: [
    ['question', 'Q_CN_T01_2_07', 'You asked to add that an IPv4 router also decreases TTL and updates the header checksum. Option C and the explanation now say so.'],
    ['activity', 'ACT_CN_A23_PACKET_TRACER', `You left "Packet Tracer and source checks pending". Checked by hand on ${CHECKED}: the /24 and /26 subnet math, the IOS commands and the two fault diagnoses are consistent, and the four reference links open at the cited sections. Packet Tracer itself was not run.`],
    ...'T01_4_01 T02_1_01 T02_1_03 T03_1_03 T03_3_01 T03_4_01 T03_4_03 T03_4_09 T03_5_04 T03_6_06 T04_1_06 T04_2_04 T05_1_01 T05_1_07 T05_2_05 T05_3_04 T06_1_01 T06_2_03 T06_3_02 T07_2_01 T07_5_01 T07_7_03 T08_2_01 T09_1_01 T09_1_04 T09_1_05 T09_1_08 T09_1_14 T10_1_01'
      .split(' ').map(t => ['resource', `RES_CN_${t}`, t === 'T07_7_03'
        ? `Automatic check on ${CHECKED}: the PDF opens and page 14 covers the slotted transmission model.` : '']),
  ] },
};
const FILES = { question: 'question_bank.jsonl', lesson: 'lesson_content.jsonl', resource: 'learning_resources.jsonl', activity: 'activities.jsonl' };
const IDKEY = { question: 'question_id', lesson: 'lesson_id', resource: 'resource_id', activity: 'activity_id' };

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

const data = { built_at: new Date().toISOString(), reviewer: 'An', courses: [] };
for (const [key, course] of Object.entries(PENDING)) {
  const cache = {};
  const items = course.items.map(([kind, id, note]) => {
    const file = path.join(project, course.dir, FILES[kind]);
    cache[file] = cache[file] || readJsonl(file);
    const record = cache[file].find(r => r[IDKEY[kind]] === id);
    if (!record) throw new Error(`${id} not found in ${file}`);
    return { kind, id, note: note || (kind === 'resource' ? LINK_OK : ''), record };
  });
  data.courses.push({ key, name: course.name, items });
}

const count = data.courses.reduce((n, c) => n + c.items.length, 0);
const json = JSON.stringify(data).replace(/</g, '\\u003c');   // keeps "</script>" in content from closing the tag
const template = fs.readFileSync(path.join(__dirname, 'an-followup.template.html'), 'utf8');
const out = template.replace('/*__DATA__*/null', json);
fs.writeFileSync(path.join(__dirname, '..', 'review-pages', 'an-followup.html'), out);
console.log(`wrote review-pages/an-followup.html with ${count} items`);
