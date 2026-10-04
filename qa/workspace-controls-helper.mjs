/** UI actions shared by local fixtures; never reaches a real desktop. */
export async function openWorkspaceControls(page){
  if(await page.locator('#workspace').isVisible()&&!await page.locator('#workspaceMenu').isVisible())await page.locator('#moreBtn').click();
}
export async function endWorkspace(page){await openWorkspaceControls(page);await page.locator('#end').click();}
