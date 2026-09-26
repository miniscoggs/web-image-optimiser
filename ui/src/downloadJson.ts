/**
 * Saves a value as a JSON file through the browser's downloads.
 *
 * @param name - The file's name.
 * @param value - The value.
 */
function downloadJson(name: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 40_000); // the download can read the blob after the click returns
}

export default downloadJson;
