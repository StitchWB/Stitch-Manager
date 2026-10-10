/**
 * Host routes of core_page plugins whose page is a built-in app route.
 * A core_page plugin absent here gets no rail tab at all.
 */
export const CORE_PAGE_ROUTES: Record<string, string> = {
  'stitch-mail': '/mail',
  'stitch-radar': '/radar',
  'stitch-opencode': '/ai/opencode-config',
  'stitch-devbox': '/ai/devbox',
  'stitch-cards': '/tools',
};
