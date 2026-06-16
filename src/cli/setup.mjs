/**
 * `knowtify setup` — prints confirmation that the hook is active.
 * No special setup steps are needed since the dialog uses osascript
 * which is built into macOS and requires no additional permissions.
 */
export async function runSetup() {
  console.log('Knowtify is ready.')
  console.log()
  console.log('When Claude asks for permission, a native macOS dialog')
  console.log('will pop up with Yes / Allow All / No buttons.')
  console.log()
  console.log('No extra permissions required.')
}
