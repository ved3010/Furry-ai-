"use strict";

const googleClassroom = require("./google-classroom");

console.log("==================================================");
console.log("   FURRY: CONNECTING GOOGLE CLASSROOM            ");
console.log("==================================================\n");

const creds = googleClassroom.getCredentials();
if (!creds.clientId || !creds.clientSecret || creds.clientId.includes("PASTE_")) {
  console.error("ERROR: Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env");
  process.exit(1);
}

const wantsSwitch = process.argv.includes("--switch") || process.argv.includes("--reconnect") || process.argv.includes("--login");
if (wantsSwitch) {
  googleClassroom.clearToken();
  console.log("Cleared previous account session. Starting fresh sign-in...\n");
}

if (!wantsSwitch && googleClassroom.isConnected()) {
  console.log("Google Classroom is ALREADY CONNECTED! 🐾");
  console.log("(Tip: To switch to your college email account, run: node connect-classroom.js --switch)\n");
  console.log("Fetching your live assignments...\n");
  googleClassroom.fetchAssignments().then((res) => {
    if (!res.ok) {
      console.error("Failed to fetch assignments:", res.message || res.error);
      process.exit(1);
    }

    console.log(`Found ${res.totalCount} pending assignments (${res.upcomingCount} upcoming):\n`);
    res.assignments.forEach((a, i) => {
      console.log(`[${i + 1}] ${a.title}`);
      console.log(`    Course: ${a.courseName}`);
      console.log(`    Due:    ${a.dueDateFormatted} (${a.isOverdue ? "OVERDUE" : `in ${a.dueInHours} hours`})`);
      console.log(`    Link:   ${a.link}\n`);
    });
    process.exit(0);
  });
} else {
  console.log("Starting Google Sign-In in your browser...");
  console.log("Please approve permissions in the opened browser tab.\n");

  googleClassroom.startAuthFlow().then(async (res) => {
    console.log("SUCCESS:", res.message);
    console.log("\nFetching your live assignments now...\n");

    const assignmentsRes = await googleClassroom.fetchAssignments();
    if (assignmentsRes.ok) {
      console.log(`Found ${assignmentsRes.totalCount} pending assignments:\n`);
      assignmentsRes.assignments.forEach((a, i) => {
        console.log(`[${i + 1}] ${a.title}`);
        console.log(`    Course: ${a.courseName}`);
        console.log(`    Due:    ${a.dueDateFormatted} (${a.isOverdue ? "OVERDUE" : `in ${a.dueInHours} hours`})`);
        console.log(`    Link:   ${a.link}\n`);
      });
    }
    process.exit(0);
  }).catch((err) => {
    console.error("Authentication failed:", err.message);
    process.exit(1);
  });
}
