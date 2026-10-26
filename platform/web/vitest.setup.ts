import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Some jsdom versions have no Blob.text(); browsers all do. Reading a File's text is what the meter import does.
if (typeof Blob !== "undefined" && typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// The first render of a page in a cold test run can take over a second when the machine is busy (the API suite runs beside it in
// CI-like use); testing-library's default of 1 s then fails a test that is correct. A longer wait costs nothing when it passes.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
