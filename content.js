(() => {
  const ADD_BUTTON_SELECTOR = "#btnShowAdd";
  const FORM_SELECTOR = ".modal-content #JobContactsForm";
  const LOG_PREFIX = "[Utah Job Contact Filler]";

  function log(message, details) {
    if (details === undefined) console.info(LOG_PREFIX, message);
    else console.info(LOG_PREFIX, message, details);
  }

  function logError(message, error) {
    console.error(LOG_PREFIX, message, error);
  }

  function report(message) {
    log(message);
    chrome.runtime.sendMessage({ type: "PROGRESS", message }).catch(() => {});
  }

  function modalForm() {
    return document.querySelector(FORM_SELECTOR);
  }

  function waitFor(predicate, timeoutMs = 10000, intervalMs = 50) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        let value = false;
        try {
          value = predicate();
        } catch (_) {
          value = false;
        }
        if (value) {
          resolve(value);
        } else if (Date.now() - started >= timeoutMs) {
          const error = new Error("Timed out waiting for the Utah form.");
          logError("Timed out while waiting for a page condition.", error);
          reject(error);
        } else {
          setTimeout(check, intervalMs);
        }
      };
      check();
    });
  }

  function nativeSetValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setField(id, value) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`The Utah form field ${id} was not found.`);
    nativeSetValue(element, value ?? "");
  }

  function setSelect(id, code) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`The Utah form field ${id} was not found.`);
    const option = [...element.options].find((item) => item.value === `string:${code}` || item.value === code);
    if (!option) throw new Error(`The Utah form did not offer option ${code} for ${id}.`);
    nativeSetValue(element, option.value);
  }

  async function openModal() {
    if (modalForm()) {
      log("Add Job Contact modal was already open.");
      return;
    }
    const button = document.querySelector(ADD_BUTTON_SELECTOR);
    if (!button) {
      const error = new Error("The Utah page did not show the Add Job Contact button.");
      logError("Could not open the Add Job Contact modal.", error);
      throw error;
    }
    log("Opening Add Job Contact modal.");
    button.click();
    await waitFor(() => modalForm(), 10000);
    log("Add Job Contact modal opened.");
  }

  async function fillModal(contact) {
    log("Filling contact fields.", {
      company: contact.company,
      position: contact.position,
      date: contact.date,
      method: contact.method,
      result: contact.result
    });
    await openModal();
    setField("AddContactViewModel_EmployerName", contact.company);
    setField("AddContactViewModel_Position", contact.position);
    setField("AddContactViewModel_ContactDate", contact.date);
    setSelect("AddContactViewModel_ContactTypeCode", contact.method);

    if (contact.method === "OT") {
      setField("AddContactViewModel_ContactComment", contact.contactComment);
    }
    if (contact.method === "WB") {
      await waitFor(() => !document.getElementById("AddContactViewModel_WebAddress")?.disabled, 3000);
      setField("AddContactViewModel_WebAddress", contact.website);
    }
    if (contact.method === "EM") {
      await waitFor(() => !document.getElementById("AddContactViewModel_EmailAddress")?.disabled, 3000);
      setField("AddContactViewModel_EmailAddress", contact.emailAddress || "");
    }
    if (contact.method === "PH") {
      await waitFor(() => !document.getElementById("AddContactViewModel_PhoneNumber")?.disabled, 3000);
      setField("AddContactViewModel_PhoneNumber", contact.phoneNumber || "");
      setField("AddContactViewModel_Address", contact.address || "");
    }
    if (contact.method === "FX") {
      await waitFor(() => !document.getElementById("AddContactViewModel_FaxNumber")?.disabled, 3000);
      setField("AddContactViewModel_FaxNumber", contact.faxNumber || "");
    }

    setSelect("AddContactViewModel_ResultTypeCode", contact.result);
    if (contact.result === "OT") {
      await waitFor(() => !document.getElementById("AddContactViewModel_ResultComment")?.disabled, 3000);
      setField("AddContactViewModel_ResultComment", contact.resultComment);
    }
  }

  function validationText() {
    const form = modalForm();
    if (!form) return "";
    return [...form.querySelectorAll(".field-validation-error, .validation-summary-errors, [aria-invalid='true']")]
      .map((element) => element.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  async function addModal() {
    const form = modalForm();
    if (!form) throw new Error("The Add Job Contact modal is not open.");
    const button = form.closest(".modal-content")?.querySelector(".modal-footer #addContactButton")
      || form.closest(".modal-content")?.querySelector("button#addContactButton");
    if (!button) {
      const error = new Error("The Utah modal Add Job Contact button was not found.");
      logError("Could not find the modal Add Job Contact button.", error);
      throw error;
    }
    log("Submitting the current Add Job Contact modal.");
    button.click();
    try {
      await waitFor(() => !modalForm(), 15000);
      log("Add Job Contact modal closed after submission.");
    } catch (_) {
      const errors = validationText();
      const error = new Error(errors || "The Utah page did not accept the contact. Check the modal for validation errors.");
      logError("The Utah page did not accept the contact.", error);
      throw error;
    }
  }

  async function fillContacts(contacts, mode) {
    if (!Array.isArray(contacts) || !contacts.length) throw new Error("No contacts were supplied.");

    if (mode === "fillOnly") {
      report(`Filling contact 1 of ${contacts.length}: ${contacts[0].company}`);
      await fillModal(contacts[0]);
      return { ok: true, message: `Filled ${contacts[0].company}. Review it, then click the modal's Add Job Contact button.` };
    }

    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      report(`Adding contact ${index + 1} of ${contacts.length}: ${contact.company}`);
      await fillModal(contact);
      await addModal();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: true, message: `Added ${contacts.length} job contacts. Review the table before clicking Continue.` };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "FILL_CONTACTS") return undefined;
    log("Received FILL_CONTACTS message.", { mode: message.mode, count: message.contacts?.length });
    fillContacts(message.contacts, message.mode)
      .then((response) => {
        log("Finished FILL_CONTACTS message.", response);
        sendResponse(response);
      })
      .catch((error) => {
        logError("FILL_CONTACTS handling failed.", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });

  log("Content script loaded.", { url: location.href, readyState: document.readyState });
})();
