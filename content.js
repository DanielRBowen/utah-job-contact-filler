(() => {
  const ADD_BUTTON_SELECTOR = "#btnShowAdd";
  const FORM_SELECTOR = "#JobContactsForm";
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

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  }

  function activeModal(element) {
    const modal = element?.closest("[uib-modal-window], .modal");
    return modal && isVisible(modal) ? modal : null;
  }

  function modalStackValue(modal) {
    const zIndex = Number(window.getComputedStyle(modal).zIndex);
    if (Number.isFinite(zIndex)) return zIndex;
    return Number(modal.getAttribute("index")) || 0;
  }

  function frontModal() {
    return [...document.querySelectorAll("[uib-modal-window]")]
      .filter(isVisible)
      .reduce((front, modal) => !front || modalStackValue(modal) > modalStackValue(front) ? modal : front, null);
  }

  function isFrontModal(element) {
    const modal = activeModal(element);
    return Boolean(modal && modal === frontModal());
  }

  function modalForm() {
    return [...document.querySelectorAll(FORM_SELECTOR)]
      .find((form) => activeModal(form)) || null;
  }

  function frontJobContactForm() {
    return [...document.querySelectorAll(FORM_SELECTOR)]
      .find(isFrontModal) || null;
  }

  function loadingModalIsOpen() {
    return [...document.querySelectorAll("[uib-modal-window] .modal-body[aria-label='Please Wait'], [uib-modal-window] #divLoading")]
      .some(isFrontModal);
  }

  function pageErrorText() {
    const errorBody = [...document.querySelectorAll("[uib-modal-window] #generic-modal-body .modal-body")]
      .find(isFrontModal);
    if (errorBody) {
      const text = errorBody.textContent.replace(/\s+/g, " ").trim();
      if (/an error has occurred|error|unable|failed/i.test(text)) return text;
    }

    const sessionBody = [...document.querySelectorAll("[uib-modal-window] #session-timeout-modal .modal-body")]
      .find(isFrontModal);
    if (sessionBody) return sessionBody.textContent.replace(/\s+/g, " ").trim();
    return "";
  }

  function dismissGenericErrorDialog() {
    const modal = frontModal();
    if (!modal?.querySelector("#generic-modal-body")) return false;
    const closeButton = [...modal.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .find((button) => /^(ok|close|dismiss|acknowledge)$/i.test(button.textContent.trim()));
    if (!closeButton) return false;
    log("Closing Utah's generic error dialog so the next contact can be attempted.");
    closeButton.click();
    return true;
  }

  // This deliberately has no deadline. Utah shows a separate loading modal while
  // requests are in flight, so the correct signal is the page state, not elapsed time.
  function waitForPageState(predicate, waitingMessage) {
    return new Promise((resolve, reject) => {
      let observer;
      let interval;
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearInterval(interval);
        callback(value);
      };

      const check = () => {
        const pageError = pageErrorText();
        if (pageError) {
          const error = new Error(`Utah reported an error: ${pageError}`);
          logError("Utah displayed an error dialog.", error);
          finish(reject, error);
          return;
        }

        try {
          const value = predicate();
          if (value) finish(resolve, value);
        } catch (error) {
          finish(reject, error);
        }
      };

      if (waitingMessage) report(waitingMessage);
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      // Attribute mutations cover normal Angular UI Bootstrap updates. The short
      // fallback check also covers a page-side property update that creates no
      // observable DOM mutation. It has no timeout and runs only until settled.
      interval = setInterval(check, 100);
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

  function setProvidedContactChannels(contact) {
    const fields = [
      ["emailAddress", "AddContactViewModel_EmailAddress"],
      ["address", "AddContactViewModel_Address"],
      ["website", "AddContactViewModel_WebAddress"],
      ["phoneNumber", "AddContactViewModel_PhoneNumber"],
      ["faxNumber", "AddContactViewModel_FaxNumber"]
    ];
    for (const [property, id] of fields) {
      if (contact[property]) setField(id, contact[property]);
    }
  }

  function clearOptionalContactFields() {
    const fieldIds = [
      "AddContactViewModel_ContactComment",
      "AddContactViewModel_WebAddress",
      "AddContactViewModel_EmailAddress",
      "AddContactViewModel_PhoneNumber",
      "AddContactViewModel_Address",
      "AddContactViewModel_FaxNumber",
      "AddContactViewModel_ResultComment"
    ];
    for (const id of fieldIds) {
      const element = document.getElementById(id);
      if (element) nativeSetValue(element, "");
    }
  }

  function clearValidationFeedback(form) {
    // Utah can leave the previous contact's validation summary in the still-open
    // modal. Clear that old feedback before submitting the next row so it is not
    // mistaken for a new failure before Angular has processed the click.
    form.querySelectorAll(".field-validation-error, .validation-summary-errors").forEach((element) => {
      element.textContent = "";
    });
    form.querySelectorAll("[aria-invalid='true']").forEach((element) => {
      element.removeAttribute("aria-invalid");
    });
    form.querySelectorAll(".input-validation-error").forEach((element) => {
      element.classList.remove("input-validation-error");
    });
  }

  function setSelect(id, code) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`The Utah form field ${id} was not found.`);
    const option = [...element.options].find((item) => item.value === `string:${code}` || item.value === code);
    if (!option) throw new Error(`The Utah form did not offer option ${code} for ${id}.`);
    nativeSetValue(element, option.value);
  }

  function addContactButton(form = modalForm()) {
    const content = form?.closest(".modal-content");
    return content?.querySelector("button[ng-click='addContact()']")
      || content?.querySelector(".modal-footer #addContactButton:not([ng-click*='cancel'])")
      || null;
  }

  async function openModal() {
    if (frontJobContactForm()) {
      log("Add Job Contact modal was already open.");
      return;
    }

    if (loadingModalIsOpen()) {
      await waitForPageState(
        () => !loadingModalIsOpen(),
        "Waiting for Utah to finish its current request before opening the contact form."
      );
      if (frontJobContactForm()) return;
    }

    const button = document.querySelector(ADD_BUTTON_SELECTOR);
    if (!button) {
      const error = new Error("The Utah page did not show the Add Job Contact button.");
      logError("Could not open the Add Job Contact modal.", error);
      throw error;
    }
    log("Opening Add Job Contact modal.");
    button.click();
    await waitForPageState(
      () => frontJobContactForm(),
      "Waiting for Utah to load the Add Job Contact form."
    );
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
    await waitForPageState(
      () => {
        const form = frontJobContactForm();
        return form
          && !document.getElementById("AddContactViewModel_EmployerName")?.disabled
          && !document.getElementById("AddContactViewModel_Position")?.disabled
          && !document.getElementById("AddContactViewModel_ContactDate")?.disabled
          && !document.getElementById("AddContactViewModel_ContactTypeCode")?.disabled
          && !document.getElementById("AddContactViewModel_ResultTypeCode")?.disabled;
      },
      "Waiting for the Add Job Contact form fields to become ready."
    );
    clearOptionalContactFields();
    setField("AddContactViewModel_EmployerName", contact.company);
    setField("AddContactViewModel_Position", contact.position);
    setField("AddContactViewModel_ContactDate", contact.date);
    setSelect("AddContactViewModel_ContactTypeCode", contact.method);

    if (contact.method === "OT") {
      await waitForPageState(
        () => frontJobContactForm() && !document.getElementById("AddContactViewModel_ContactComment")?.disabled,
        "Waiting for Utah to enable the Contact Comment field."
      );
      setField("AddContactViewModel_ContactComment", contact.contactComment);
      if (contact.website) {
        await waitForPageState(
          () => frontJobContactForm() && !document.getElementById("AddContactViewModel_WebAddress")?.disabled,
          "Waiting for Utah to enable the Web Address field."
        );
        setField("AddContactViewModel_WebAddress", contact.website);
      }
    }
    if (contact.method === "WB") {
      await waitForPageState(
        () => frontJobContactForm() && !document.getElementById("AddContactViewModel_WebAddress")?.disabled,
        "Waiting for Utah to enable the Web Address field."
      );
      setField("AddContactViewModel_WebAddress", contact.website);
    }
    if (contact.method === "EM") {
      await waitForPageState(
        () => frontJobContactForm() && !document.getElementById("AddContactViewModel_EmailAddress")?.disabled,
        "Waiting for Utah to enable the Email Address field."
      );
      setField("AddContactViewModel_EmailAddress", contact.emailAddress || "");
    }
    if (contact.method === "PH") {
      await waitForPageState(
        () => frontJobContactForm()
          && (!contact.phoneNumber || !document.getElementById("AddContactViewModel_PhoneNumber")?.disabled)
          && (!contact.address || !document.getElementById("AddContactViewModel_Address")?.disabled),
        "Waiting for Utah to enable the Phone and Address fields."
      );
      if (contact.phoneNumber) setField("AddContactViewModel_PhoneNumber", contact.phoneNumber);
      if (contact.address) setField("AddContactViewModel_Address", contact.address);
    }
    if (contact.method === "FX") {
      await waitForPageState(
        () => frontJobContactForm() && !document.getElementById("AddContactViewModel_FaxNumber")?.disabled,
        "Waiting for Utah to enable the Fax field."
      );
      setField("AddContactViewModel_FaxNumber", contact.faxNumber || "");
    }

    setSelect("AddContactViewModel_ResultTypeCode", contact.result);
    if (contact.result === "OT") {
      await waitForPageState(
        () => frontJobContactForm() && !document.getElementById("AddContactViewModel_ResultComment")?.disabled,
        "Waiting for Utah to enable the Result Comment field."
      );
      setField("AddContactViewModel_ResultComment", contact.resultComment);
    }

    // The Utah form requires at least one contact channel, independent of the
    // selected contact method. Include any supplied channels for OT and other
    // methods as well (for example, contact.email and contact.address).
    setProvidedContactChannels(contact);
  }

  function validationText() {
    const form = frontJobContactForm() || modalForm();
    if (!form) return "";
    return [...form.querySelectorAll(".field-validation-error, .validation-summary-errors, [aria-invalid='true']")]
      .map((element) => element.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  function contactGridRowCount() {
    return document.querySelectorAll("#workSearchContactsGrid tbody tr").length;
  }

  async function addModal() {
    let form = frontJobContactForm();
    if (!form) throw new Error("The Add Job Contact modal is not open.");
    await waitForPageState(
      () => {
        form = frontJobContactForm();
        const button = addContactButton(form);
        return form && button && !button.disabled ? button : false;
      },
      "Waiting for Utah to enable the Add Job Contact button."
    );
    const button = addContactButton(form);
    if (!button) throw new Error("The Utah modal Add Job Contact button was not found.");
    clearValidationFeedback(form);
    const rowCountBeforeSave = contactGridRowCount();
    log("Submitting the current Add Job Contact modal.");
    button.click();
    await waitForPageState(
      () => {
        const errors = validationText();
        if (errors && !loadingModalIsOpen() && modalForm()) {
          throw new Error(`Utah did not accept this contact: ${errors}`);
        }
        return !modalForm() && !loadingModalIsOpen() && contactGridRowCount() > rowCountBeforeSave;
      },
      "Waiting for Utah to save the contact and update the Job Contacts list."
    );
    log("Utah saved the contact and added it to the Job Contacts list.");
  }

  async function fillContacts(contacts, mode) {
    if (!Array.isArray(contacts) || !contacts.length) throw new Error("No contacts were supplied.");

    if (mode === "fillOnly") {
      report(`Filling contact 1 of ${contacts.length}: ${contacts[0].company}`);
      await fillModal(contacts[0]);
      return { ok: true, message: `Completed filling ${contacts[0].company}. Review it, then click the modal's Add Job Contact button.` };
    }

    const addedIndexes = [];
    const failures = [];
    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      report(`Adding contact ${index + 1} of ${contacts.length}: ${contact.company}`);
      try {
        await fillModal(contact);
        await addModal();
        addedIndexes.push(index);
      } catch (error) {
        const message = error?.message || String(error);
        failures.push({ index, company: contact.company, error: message });
        logError(`Could not add contact ${index + 1} of ${contacts.length}: ${contact.company}. Continuing with the next contact.`, error);
        dismissGenericErrorDialog();
        report(`Could not add ${contact.company}: ${message}. Continuing with the next contact.`);
      }
    }
    const addedCount = addedIndexes.length;
    return {
      ok: failures.length === 0,
      addedCount,
      addedIndexes,
      failures,
      message: failures.length
        ? `Finished attempting all ${contacts.length} contacts. Added ${addedCount}; ${failures.length} could not be added. Review the popup for contact-specific errors.`
        : `Completed: added ${addedCount} job contacts. Review the table before clicking Continue.`
    };
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
        sendResponse({ ok: false, error: error.message, addedCount: error.addedCount || 0 });
      });
    return true;
  });

  log("Content script loaded.", { url: location.href, readyState: document.readyState });
})();
