# Utah Job Contact Filler

A small, local Microsoft Edge Manifest V3 extension for entering job-search contacts on the Utah Department of Workforce Services weekly-claim **Job Contacts** page.

It accepts JSON or CSV, previews the normalized contacts, fills the Utah form, and can add contacts one at a time or as a batch. It never clicks the weekly-claim page's **Continue** button and never submits the claim.

## What it does

- Imports job contacts from JSON or CSV.
- Accepts a JSON array, `{ "contacts": [...] }`, or `{ "jobContacts": [...] }`.
- Accepts a nested Indeed or job-posting URL such as `contact.url`.
- Maps human-readable methods and outcomes to the codes used by the Utah form.
- Shows a preview before interacting with the page.
- Lets you delete individual preview rows or clear the entire list.
- Fills the first pending contact with **Fill current modal**.
- Fills and adds all pending contacts with **Fill & add all**.
- Waits for Utah's **Please wait...** dialog to finish at every form-open and save step, with no fixed timeout.
- Confirms a saved contact has appeared in the Job Contacts grid before moving to the next one.
- Tracks contacts as **Pending**, **Filled**, or **Added** in the preview and saved draft.
- Stores the draft locally in Edge. It does not call an AI service or send the data to a server.

## Installation

1. Download or clone this repository.
2. Open `edge://extensions` in Microsoft Edge.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the folder containing `manifest.json`.
6. In the extension's site-access settings, allow it to run on the Utah jobs site if Edge asks.
7. Open or reload the Utah Job Contacts page:

   `https://jobs.utah.gov/ui/home/weeklyclaims/WeeklyFiling/JobContacts`

If the extension files change, click **Reload** on the extension card and hard-refresh the Utah page with `Ctrl+Shift+R`.

## Normal workflow

1. Open the Utah Job Contacts page and sign in normally.
2. Click the extension icon.
3. Paste JSON, paste CSV, or choose **Load example**.
4. Click **Parse and preview**.
5. Delete any rows you do not want to enter.
6. Choose one of the filling modes below.
7. Review the contacts on the Utah page before clicking the site's **Continue** button.

### Fill current modal

This mode is useful when you want to review each Utah modal before adding it:

1. Click **Fill current modal**.
2. The first pending row is placed into the open modal, or the extension opens the modal for you.
3. After the fields are filled successfully, the row is marked **Filled** in the preview and saved JSON.
4. Click the Utah modal's **Add Job Contact** button yourself.
5. Repeat **Fill current modal** for the next pending row.

The extension does not know when you manually click the site's Add button, so click that button before advancing to the next row. A Filled row is not sent again.

### Fill & add all

This mode processes every pending row. For each contact, it opens the modal, waits for Utah's loading dialog to clear, fills the fields, clicks the modal's **Add Job Contact** button, then waits until the loading dialog has cleared and the new row appears in the Job Contacts grid. It observes modal changes and also checks every 100 ms as a fallback, with no fixed timeout or deadline. Successful rows are marked **Added**. The batch still stops before the site's weekly-claim **Continue** button.

Do not reload the same source data as a fresh list and run it again; that can create duplicates. Use the existing preview to resume a batch after an error.

If Utah displays its generic error dialog or a validation error, the batch stops at that contact and keeps it **Pending**. Contacts already confirmed in the grid are retained as **Added**, so after resolving the Utah-side issue you can run the batch again without resending those earlier contacts. A save that ends in a Utah error is not automatically retried because the site does not provide an idempotent save confirmation; retrying it blindly could create a duplicate.

## JSON formats

The simplest format is an array:

```json
[
  {
    "date": "2026-07-27",
    "company": "Example Company",
    "position": "Software Engineer",
    "method": "Online application via Indeed",
    "website": "https://www.indeed.com/viewjob?jk=example",
    "result": "Still Waiting"
  }
]
```

An object with `contacts` or `jobContacts` is also supported. The nested `contact.url` form is accepted:

```json
{
  "jobContacts": [
    {
      "date": "2026-07-27",
      "company": "Example Company",
      "contact": {
        "url": "https://www.indeed.com/viewjob?jk=example"
      },
      "position": "Software Engineer",
      "method": "Online application via Indeed",
      "result": "Application submitted; awaiting employer response"
    }
  ]
}
```

The parser recognizes these common field aliases:

- Company: `company`, `companyName`, `employer`, or `employerName`
- Position: `position`, `positionTitle`, `jobTitle`, or `title`
- URL: `website`, `webAddress`, `url`, `jobPostingUrl`, `jobUrl`, or nested `contact.url`. For `OT` contacts, nested `contact.teams_meeting_url` is used as the Web Address when no top-level URL is supplied. Markdown links and enclosing brackets are removed automatically; URLs must use `http://` or `https://`.
- Contact details: `phoneNumber`, `phone`, `address`, `faxNumber`, and `emailAddress` may be top-level or nested in `contact` (for example, `contact.phoneNumber`). `contactComment` may also be nested.
- Date: ISO dates such as `2026-07-27`, US dates, and other values recognized by JavaScript's date parser
- Result: codes or phrases such as `Still Waiting`, `awaiting employer response`, `interview`, `hired`, `not hiring`, `not selected by employer`, `rejected`, and `position filled`. “Not selected” and “rejected” map to Utah's `NH` result code.

Supported Utah contact methods include:

- `WB`: online or company-website application; the URL is placed in **Web Address**
- `EM`: email; provide `emailAddress`
- `PH`: phone or in-person contact; provide a phone number or address
- `FX`: fax; provide `faxNumber`
- `OT`: other; provide `contactComment`

For a result of `OT`, provide `resultComment`.

The saved draft may contain a `status` property. The extension uses `pending`, `filled`, and `added` to prevent already-processed rows from being sent again. Removing the status or loading fresh data resets the row to pending.

## CSV

CSV should include a header row. For example:

```csv
date,company,position,method,website,result,resultComment
2026-07-27,Example Company,Software Engineer,Online application via Indeed,https://www.indeed.com/viewjob?jk=example,Still Waiting,
```

The repository includes [`example-contacts.csv`](example-contacts.csv) and [`example-contacts.json`](example-contacts.json).

## Troubleshooting

### “Could not establish connection. Receiving end does not exist.”

This means the popup could not find the page-side content script. Check the following:

1. In `edge://extensions`, make sure the extension is enabled and click **Reload**.
2. Confirm Edge allows the extension to run on `jobs.utah.gov`.
3. Hard-refresh the Utah page with `Ctrl+Shift+R`.
4. Make sure the Utah page is the active tab when opening the extension popup.
5. Check the Utah page's DevTools Console for messages beginning with `[Utah Job Contact Filler]`.

The popup also has an on-demand injection fallback. When it cannot find a receiver, it tries to inject `content.js` into the active Utah page and retries the message.

### Diagnostic logging

Open DevTools on the Utah page with `F12` and filter the Console for:

```text
[Utah Job Contact Filler]
```

The page console reports content-script loading, modal discovery, field filling, validation errors, and batch progress. Inspect the extension popup itself to see the selected tab URL and message-delivery logs.

### Form validation errors and Utah error dialogs

The Utah page may reject a contact if a conditional field is missing or if a value does not match the current site's options. Use **Fill current modal** to inspect the modal before adding it. The extension reports visible validation text when it can read it.

For a generic Utah error dialog, preserve the contact data, acknowledge the dialog, resolve the page/session issue, and run the batch again. The extension never abandons an in-progress loading dialog because of an arbitrary elapsed-time limit, but it does stop immediately when Utah explicitly reports an error.

## Privacy and safety

- Contact data stays in the extension's local Edge storage and the active Utah page.
- No AI API, analytics service, or external data service is used.
- The extension is limited to the Utah weekly-filing route and the active tab.
- It does not click the weekly-claim **Continue** button or submit the claim.
- Review every contact for accuracy. Automation should not be used to submit inaccurate job-search information.

## Development checks

From the repository folder:

```powershell
node --check popup.js
node --check content.js
```

The extension has no build step. Reload the unpacked extension after editing its files.

## Repository layout

- `manifest.json`: extension permissions, URL matches, and popup configuration
- `popup.html`, `popup.css`, `popup.js`: import, preview, queue, and logging UI
- `content.js`: Utah page form interaction and modal automation
- `example-contacts.json`, `example-contacts.csv`: sample input files
