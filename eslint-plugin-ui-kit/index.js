/* eslint-disable @typescript-eslint/no-require-imports -- ESLint plugins must be CommonJS */
const path = require('path');

/**
 * Detects hardcoded UI patterns that should use UI-kit components
 */
function getAttributeValue(node, attrName) {
  const attr = node.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name?.name === attrName
  );
  if (!attr) return null;
  if (attr.value?.type === 'Literal') return attr.value.value;
  if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression?.type === 'Literal')
    return attr.value.expression.value;
  return null;
}

module.exports = {
  rules: {
    'no-hardcoded-ui': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Detect hardcoded UI patterns that should use UI-kit components',
          category: 'Best Practices',
          recommended: true,
        },
        schema: [],
        messages: {
          hardcodedDropdown:
            'Hardcoded dropdown detected (absolute/fixed + z-index + shadow + bg). Use DropdownMenu or UI-kit popover component instead.',
          hardcodedCard:
            'Hardcoded card section detected (bg-[#...] + border + rounded). Use Card, GlassCard, or StatCard component instead.',
          hardcodedModal:
            'Hardcoded modal/sidebar detected (fixed/absolute + backdrop blur + bg-black/...). Use Modal, ActionDialog, or ConfirmDialog component instead.',
          hardcodedStickyHeader:
            'Hardcoded sticky header/bar detected (sticky + z-index + backdrop-blur). Use StickyToolbar or ListHeaderRow component instead.',
          hardcodedBadge:
            'Hardcoded badge/chip detected (px-2 py-0.5 + rounded-full + border). Use Badge component instead.',
          hardcodedColorToken:
            'Hardcoded theme color {{color}} detected. Use CSS variables or theme tokens instead.',
        },
      },
      create(context) {
        // Skip files inside src/components/ui/
        const filename = context.getFilename();
        if (filename.includes(path.join('src', 'components', 'ui'))) {
          return {};
        }

        return {
          JSXOpeningElement(node) {
            const className = getAttributeValue(node, 'className');
            if (!className) return;

            // Rule 1: Hardcoded dropdowns / popovers
            // absolute/fixed + z- + shadow + bg-slate/bg-[#
            if (
              (className.includes('absolute') || className.includes('fixed')) &&
              className.includes('z-') &&
              (className.includes('shadow-') || className.includes('shadow-xl')) &&
              (className.includes('bg-slate-') ||
                className.includes('bg-[#') ||
                className.includes('bg-black'))
            ) {
              context.report({
                node,
                messageId: 'hardcodedDropdown',
              });
              return;
            }

            // Rule 2: Hardcoded cards / sections
            // bg-[#...] + border + rounded-xl/rounded-2xl
            if (
              className.includes('bg-[#') &&
              className.includes('border') &&
              (className.includes('rounded-xl') || className.includes('rounded-2xl') || className.includes('rounded-lg'))
            ) {
              context.report({
                node,
                messageId: 'hardcodedCard',
              });
              return;
            }

            // Rule 3: Hardcoded modals / drawers
            // backdrop-blur + bg-black/... + fixed/absolute + z-
            if (
              (className.includes('fixed') || className.includes('absolute')) &&
              className.includes('backdrop-blur') &&
              className.includes('bg-black')
            ) {
              context.report({
                node,
                messageId: 'hardcodedModal',
              });
              return;
            }

            // Rule 4: Hardcoded sticky headers
            // sticky + z- + backdrop-blur + rounded-xl/p-3/p-4/shadow (floating toolbar/card pattern)
            // Skip <header> and <nav> elements (page headers and nav bars are expected to be sticky)
            if (
              className.includes('sticky') &&
              className.includes('z-') &&
              className.includes('backdrop-blur') &&
              (className.includes('rounded-xl') || className.includes('shadow'))
            ) {
              const tagName = node.parent?.openingElement?.name?.name;
              const attributes = node.parent?.openingElement?.attributes || [];
              const hasBannerRole = attributes.some(
                attr => attr.type === 'JSXAttribute' &&
                  attr.name?.name === 'role' &&
                  attr.value?.value === 'banner'
              );
              if (tagName === 'header' || tagName === 'nav' || hasBannerRole) {
                return;
              }
              context.report({
                node,
                messageId: 'hardcodedStickyHeader',
              });
              return;
            }

            // Rule 5: Hardcoded badges
            // px-2 + py-0.5 + rounded-full + border
            if (
              className.includes('px-2') &&
              className.includes('py-0.5') &&
              className.includes('rounded-full') &&
              className.includes('border')
            ) {
              context.report({
                node,
                messageId: 'hardcodedBadge',
              });
              return;
            }

            // Rule 6: Hardcoded theme colors
              const hexColors = className.match(/bg-\[#([0-9a-fA-F]{3,8})\]/g);
              if (hexColors) {
                hexColors.forEach((color) => {
                  context.report({
                    node,
                    messageId: 'hardcodedColorToken',
                    data: { color },
                  });
                });
              }
          },
        };
      },
    },
    'no-confirm-dialog': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Bans confirmation modals outside the UI kit. The standard confirm pattern is the two-step ConfirmActionButton (first click arms red, second executes).',
          category: 'Best Practices',
          recommended: true,
        },
        schema: [],
        messages: {
          noConfirmDialog:
            'Confirm modals are banned here. Use the UI-kit two-step pattern: ConfirmActionButton (or an armed two-step state) instead of ConfirmDialog.',
        },
      },
      create(context) {
        // Skip files inside src/components/ui/ (the kit itself hosts ConfirmDialog)
        const filename = context.getFilename();
        if (filename.includes(path.join('src', 'components', 'ui'))) {
          return {};
        }

        return {
          JSXOpeningElement(node) {
            if (node.name.type === 'JSXIdentifier' && node.name.name === 'ConfirmDialog') {
              context.report({ node, messageId: 'noConfirmDialog' });
            }
          },
        };
      },
    },
  },
};
