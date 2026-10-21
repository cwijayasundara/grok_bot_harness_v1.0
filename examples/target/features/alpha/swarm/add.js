export default async function add({ page }) {
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByText("1").waitFor();
}
