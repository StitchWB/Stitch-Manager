/**
 * Host routes of core_page plugins whose page is a built-in app route.
 * A core_page plugin absent here gets no rail tab at all.
 */
export const CORE_PAGE_ROUTES: Record<string, string> = {
  'stitch-mail': '/mail',
  'stitch-radar': '/radar',
  'stitch-devbox': '/ai/devbox',
  'stitch-cards': '/tools',
};

// checked by link resolvers before CORE_PAGE_ROUTES
export const CANONICAL_PLUGIN_ROUTES: Record<string, string> = {
  'stitch-antigravity': '/ai/antigravity',
  'stitch-notebooklm': '/ai/notebooklm',
};
