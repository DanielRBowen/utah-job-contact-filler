const EXAMPLE_JSON = `[
  {
    "date": "2026-07-27",
    "company": "Becklar",
    "website": "https://www.indeed.com/viewjob?jk=e4cc7402e3e9aa34",
    "position": "Software Engineer – II",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  },
  {
    "date": "2026-07-28",
    "company": "Time2Market",
    "website": "https://www.indeed.com/viewjob?jk=fc9a3e966812d5e5",
    "position": "C# .NET Developer",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  },
  {
    "date": "2026-07-29",
    "company": "Payentry",
    "website": "https://www.indeed.com/viewjob?jk=25bb783c69d514b8",
    "position": "Junior Software Engineer",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  },
  {
    "date": "2026-07-30",
    "company": "DataAnnotation",
    "website": "https://www.indeed.com/viewjob?jk=f1048fb8622d3e38",
    "position": "Accessibility QA Engineer – AI Trainer",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  },
  {
    "date": "2026-07-31",
    "company": "Synergy BIS",
    "website": "https://www.indeed.com/viewjob?jk=1cc8d4f409569bfe&hl=en",
    "position": ".NET Developer (Remote)",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  },
  {
    "date": "2026-08-01",
    "company": "Kreative Technologies",
    "website": "https://www.indeed.com/viewjob",
    "position": "Junior Application Developer (Application Modernization)",
    "method": "Online application via Indeed",
    "result": "Still Waiting"
  }
]`;

const CSV_TEMPLATE = `date,company,position,method,website,result,resultComment
2026-07-27,Example Company,Software Engineer,Online application via Indeed,https://www.indeed.com/viewjob?jk=example,Still Waiting,`;

let contacts = [];
let isBusy = false;
const LOG_PREFIX = "[Utah Job Contact Filler]";

const $ = (id) => document.getElementById(id);

function log(message, details) {
  if (details === undefined) console.info(LOG_PREFIX, message);
  else console.info(LOG_PREFIX, message, details);
}

function logError(message, error) {
  console.error(LOG_PREFIX, message, error);
}

function setStatus(message, kind = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function setButtons(enabled) {
  const hasPending = contacts.some((contact) => contact.status === "pending");
  $("fillCurrent").disabled = !enabled || !hasPending;
  $("addAll").disabled = !enabled || !hasPending;
  $("clearContacts").disabled = !enabled;
}

function renderPreview() {
  const container = $("preview");
  container.replaceChildren();
  $("clearContacts").disabled = contacts.length === 0;

  if (!contacts.length) {
    setButtons(false);
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["#", "Company", "Position", "Date", "Method", "Result", "Status", "Actions"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  contacts.forEach((contact, index) => {
    const row = document.createElement("tr");
    for (const value of [
      String(index + 1),
      contact.company,
      contact.position,
      contact.date,
      `${contact.method} ${contact.website ? "(URL provided)" : ""}`,
      contact.result,
      contact.status === "pending" ? "Pending" : contact.status === "filled" ? "Filled" : "Added"
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      row.append(td);
    }

    if (contact.status !== "pending") row.classList.add("completed");

    const actions = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action secondary";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete contact ${index + 1}: ${contact.company}`);
    deleteButton.addEventListener("click", () => removeContact(index));
    actions.append(deleteButton);
    row.append(actions);
    body.append(row);
  });
  table.append(body);
  container.append(table);
  setButtons(true);
}

function saveDraft() {
  chrome.storage.local.set({ draft: $("dataInput").value }).catch((error) => {
    logError("Could not save the current draft.", error);
  });
}

function syncInputToContacts() {
  const draftContacts = contacts.map(({ errors, ...contact }) => contact);
  $("dataInput").value = JSON.stringify(draftContacts, null, 2);
  saveDraft();
}

function pendingContacts() {
  return contacts.filter((contact) => contact.status === "pending");
}

async function sendMessageWithInjection(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const connectionError = /Receiving end does not exist|Could not establish connection/i.test(error?.message || "");
    if (!connectionError) throw error;

    log("No content-script receiver found. Injecting content.js and retrying.", { tabId });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    log("Injected content.js successfully. Retrying FILL_CONTACTS.", { tabId });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function markContacts(status, selectedContacts) {
  const selected = new Set(selectedContacts);
  for (const contact of contacts) {
    if (selected.has(contact)) contact.status = status;
  }
  syncInputToContacts();
  renderPreview();
}

function removeContact(index) {
  const [removed] = contacts.splice(index, 1);
  if (!removed) return;
  syncInputToContacts();
  renderPreview();
  setStatus(
    contacts.length
      ? `Deleted ${removed.company}. ${contacts.length} contact${contacts.length === 1 ? "" : "s"} remaining.`
      : `Deleted ${removed.company}. No contacts remain.`,
    "success"
  );
  log("Deleted contact from preview.", { index, company: removed.company, remaining: contacts.length });
}

function clearContacts() {
  if (!contacts.length) return;
  const count = contacts.length;
  contacts = [];
  $("dataInput").value = "";
  saveDraft();
  renderPreview();
  setStatus(`Cleared ${count} contact${count === 1 ? "" : "s"}.`, "success");
  log("Cleared all contacts from preview.", { count });
}

function parseAndRender() {
  try {
    log("Parsing contact data.");
    contacts = parseContacts($("dataInput").value);
    renderPreview();
    setStatus(`${contacts.length} contact${contacts.length === 1 ? "" : "s"} ready. Review the preview before filling.`, "success");
    saveDraft();
    log("Parsed contacts successfully.", { count: contacts.length });
  } catch (error) {
    contacts = [];
    renderPreview();
    setStatus(error.message, "error");
    logError("Could not parse contact data.", error);
  }
}

function parseContacts(raw) {
  const text = raw.trim();
  if (!text) throw new Error("Paste JSON or CSV first.");

  let rows;
  if (text.startsWith("[") || text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    rows = Array.isArray(parsed) ? parsed : parsed.contacts ?? parsed.jobContacts;
    if (!Array.isArray(rows)) {
      throw new Error("JSON must be an array or an object with a contacts or jobContacts array.");
    }
  } else {
    rows = parseCsv(text);
  }

  const normalized = rows.map((row, index) => normalizeContact(row, index));
  const errors = normalized.flatMap((contact, index) => contact.errors.map((error) => `Row ${index + 1}: ${error}`));
  if (errors.length) throw new Error(errors.join(" "));
  return normalized;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    const next = text[i + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  if (rows.length < 2) throw new Error("CSV must contain a header row and at least one contact.");
  const headers = rows[0].map(normalizeKey);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

function normalizeContact(row, index) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { errors: [`Contact ${index + 1} is not an object.`] };
  }

  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, item]) => [normalizeKey(key), item])
  );
  const nestedContact = row.contact && typeof row.contact === "object" && !Array.isArray(row.contact)
    ? row.contact
    : {};
  const normalizedNestedContact = Object.fromEntries(
    Object.entries(nestedContact).map(([key, item]) => [normalizeKey(key), item])
  );
  const value = (...keys) => {
    for (const key of keys) {
      const item = row[key] ?? normalizedRow[normalizeKey(key)];
      if (item !== undefined && item !== null && String(item).trim()) return String(item).trim();
    }
    return "";
  };
  const nestedValue = (...keys) => {
    for (const key of keys) {
      const item = nestedContact[key] ?? normalizedNestedContact[normalizeKey(key)];
      if (item !== undefined && item !== null && String(item).trim()) return String(item).trim();
    }
    return "";
  };

  const company = value("company", "companyName", "employer", "employerName", "Company Name");
  const position = value("position", "positionTitle", "jobTitle", "title", "Position");
  const website = value("website", "webAddress", "url", "jobPostingUrl", "jobUrl", "Web Address")
    || nestedValue("url", "website", "webAddress");
  const date = normalizeDate(value("date", "contactDate", "contact_date", "Contact Date"));
  const method = normalizeMethod(value("method", "contactMethod", "contactTypeCode", "Contact Method"));
  const result = normalizeResult(value("result", "resultType", "resultTypeCode", "Result"));
  const contactComment = value("contactComment", "comment", "Contact Comment");
  const resultComment = value("resultComment", "specificResult", "Result Comment");
  const address = value("address", "Address");
  const phoneNumber = value("phoneNumber", "phone", "Phone");
  const faxNumber = value("faxNumber", "fax", "Fax");
  const emailAddress = value("emailAddress", "email", "Email Address");
  const suppliedStatus = value("status", "state", "progress").toLowerCase();
  const status = ["filled", "added"].includes(suppliedStatus) ? suppliedStatus : "pending";
  const errors = [];

  if (!company) errors.push("company is required.");
  if (!position) errors.push("position is required.");
  if (!date) errors.push("date is required and must be a valid date.");
  if (!method) errors.push("method must be WB, EM, FX, PH, or OT, or describe one of the supported methods.");
  if (!result) errors.push("result must be a supported result such as Still Waiting.");
  if (method === "WB" && !website) errors.push("website is required for an online/company-website application.");
  if (method === "OT" && !contactComment) errors.push("contactComment is required when method is OT.");
  if (result === "OT" && !resultComment) errors.push("resultComment is required when result is OT.");
  if (method === "EM" && !emailAddress) errors.push("emailAddress is required when method is EM.");
  if (method === "FX" && !faxNumber) errors.push("faxNumber is required when method is FX.");
  if (method === "PH" && !address && !phoneNumber) errors.push("address or phoneNumber is required when method is PH.");

  return {
    company,
    position,
    website,
    date,
    method,
    result,
    contactComment,
    resultComment,
    address,
    phoneNumber,
    faxNumber,
    emailAddress,
    status,
    errors
  };
}

function normalizeKey(value) {
  return String(value).trim().replace(/^\ufeff/, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeDate(value) {
  if (!value) return "";
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[2].padStart(2, "0")}/${iso[3].padStart(2, "0")}/${iso[1]}`;
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[1].padStart(2, "0")}/${us[2].padStart(2, "0")}/${us[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}/${parsed.getFullYear()}`;
}

function normalizeMethod(value) {
  const text = value.toLowerCase();
  if (value.toUpperCase() === "WB" || /website|indeed|online application|completed application/.test(text)) return "WB";
  if (value.toUpperCase() === "EM" || /email|emailed/.test(text)) return "EM";
  if (value.toUpperCase() === "FX" || /fax/.test(text)) return "FX";
  if (value.toUpperCase() === "PH" || /phone|in person|spoke/.test(text)) return "PH";
  if (value.toUpperCase() === "OT" || /other/.test(text)) return "OT";
  return "";
}

function normalizeResult(value) {
  const text = value.toLowerCase();
  const codes = new Set(["HI", "IT", "JO", "NH", "NP", "OT", "PF", "SW"]);
  if (codes.has(value.toUpperCase())) return value.toUpperCase();
  if (/hired/.test(text)) return "HI";
  if (/interview/.test(text)) return "IT";
  if (/job offered|offered/.test(text)) return "JO";
  if (/not hiring/.test(text)) return "NH";
  if (/no response/.test(text)) return "NP";
  if (/other/.test(text)) return "OT";
  if (/position filled|filled/.test(text)) return "PF";
  if (/still waiting|awaiting|waiting|pending|under review/.test(text)) return "SW";
  return "";
}

async function readFile(file) {
  $("dataInput").value = await file.text();
  parseAndRender();
}

async function sendToPage(type) {
  if (isBusy) return;
  isBusy = true;
  $("fillCurrent").disabled = true;
  $("addAll").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    log("Selected active tab.", { id: tab?.id, url: tab?.url, title: tab?.title });
    if (!tab?.id || !tab.url?.startsWith("https://jobs.utah.gov/ui/home/weeklyclaims/WeeklyFiling/JobContacts")) {
      throw new Error("Open the Utah DWS Job Contacts page in the active tab first.");
    }
    const mode = type === "fillCurrent" ? "fillOnly" : "addAll";
    const pending = pendingContacts();
    if (!pending.length) throw new Error("All contacts are already filled or added. Load or parse another list to continue.");
    const selectedContacts = mode === "fillOnly" ? pending.slice(0, 1) : pending;
    log("Sending FILL_CONTACTS message.", { tabId: tab.id, mode, count: selectedContacts.length });
    const result = await sendMessageWithInjection(tab.id, { type: "FILL_CONTACTS", mode, contacts: selectedContacts });
    log("Received response from content script.", result);
    if (!result?.ok) throw new Error(result?.error || "The page could not be filled.");
    markContacts(mode === "fillOnly" ? "filled" : "added", selectedContacts);
    setStatus(
      mode === "fillOnly"
        ? `${result.message} Marked as Filled. Click the modal's Add Job Contact button, then fill current modal again for the next row.`
        : result.message,
      "success"
    );
  } catch (error) {
    logError("FILL_CONTACTS message failed.", error);
    setStatus(`${error.message} If the page was already open when you installed the extension, reload it once.`, "error");
  } finally {
    isBusy = false;
    setButtons(contacts.length > 0);
  }
}

$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) readFile(file).catch((error) => setStatus(error.message, "error"));
});

$("loadExample").addEventListener("click", () => {
  $("dataInput").value = EXAMPLE_JSON;
  parseAndRender();
});

$("parseButton").addEventListener("click", parseAndRender);

$("fillCurrent").addEventListener("click", () => sendToPage("fillCurrent"));

$("clearContacts").addEventListener("click", clearContacts);

$("addAll").addEventListener("click", async () => {
  const confirmed = window.confirm(
    `This will add ${contacts.length} job contacts to the Utah DWS page. It will not click Continue or submit the weekly claim. Continue?`
  );
  if (confirmed) await sendToPage("addAll");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PROGRESS" && isBusy) setStatus(message.message);
});

chrome.storage.local.get(["draft"], ({ draft }) => {
  log("Loaded saved draft.", { hasDraft: Boolean(draft), length: draft?.length || 0 });
  if (draft) {
    $("dataInput").value = draft;
    parseAndRender();
  }
});

log("Popup loaded.");
