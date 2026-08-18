/**
 * Local Overrides Module
 *
 * User-edited scenario overrides for installed plugin packages.  An override
 * lives at <data_dir>/overrides/<plugin_id>/scenario.json and wins at run
 * time over the resolved package's scenario (plan §8 v1.1).
 *
 * Commands:
 *   - list_overrides (readonly): union of installed packages with status
 *   - create_override: copy resolved package scenario into overrides dir
 *   - validate_override: parse via autoreg.scenario.parse_v2
 *   - clear_override: remove override dir
 *   - submit_override: open a patch-candidate GitHub PR
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface OverrideEntry {
  plugin_id: string;
  has_override: boolean;
  valid: boolean;
  path: string;
  error?: string;
}

export interface ListOverridesResponse {
  overrides: OverrideEntry[];
}

export interface CreateOverrideParams {
  plugin_id: string;
}

export interface CreateOverrideResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ValidateOverrideParams {
  plugin_id: string;
}

export interface ValidateOverrideResult {
  valid: boolean;
  error?: string;
}

export interface ClearOverrideParams {
  plugin_id: string;
}

export interface ClearOverrideResult {
  success: boolean;
  error?: string;
}

export interface SubmitOverrideParams {
  plugin_id: string;
  github_token: string;
}

export interface SubmitOverrideResult {
  success: boolean;
  pr_url?: string;
  error?: string;
}

// ============================================
// Commands
// ============================================

/**
 * List override status for the union of installed packages.
 */
export async function listOverrides(): Promise<ListOverridesResponse> {
  return safeInvoke<ListOverridesResponse>('list_overrides');
}

/**
 * Copy the currently resolved package's scenario.json into the overrides dir.
 */
export async function createOverride(
  params: CreateOverrideParams,
): Promise<CreateOverrideResult> {
  return safeInvoke<CreateOverrideResult>('create_override', {
    plugin_id: params.plugin_id,
  });
}

/**
 * Parse the override scenario via autoreg.scenario.parse_v2.
 */
export async function validateOverride(
  params: ValidateOverrideParams,
): Promise<ValidateOverrideResult> {
  return safeInvoke<ValidateOverrideResult>('validate_override', {
    plugin_id: params.plugin_id,
  });
}

/**
 * Remove the override dir for a plugin.
 */
export async function clearOverride(
  params: ClearOverrideParams,
): Promise<ClearOverrideResult> {
  return safeInvoke<ClearOverrideResult>('clear_override', {
    plugin_id: params.plugin_id,
  });
}

/**
 * Submit the override scenario as a patch-candidate PR.
 * The `github_token` is used only for this request and is not persisted
 * by the backend.
 */
export async function submitOverride(
  params: SubmitOverrideParams,
): Promise<SubmitOverrideResult> {
  return safeInvoke<SubmitOverrideResult>('submit_override', {
    plugin_id: params.plugin_id,
    github_token: params.github_token,
  });
}
