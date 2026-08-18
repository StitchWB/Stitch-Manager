import { t } from "@/lib/i18n";import { Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  useIdentityGraphPanel,
  type UseIdentityGraphPanelProps } from
'@/hooks/useIdentityGraphPanel';
import {
  IdentityGraphHeader,
  IdentityGraphAlerts,
  IdentityGraphDiagnostics,
  IdentityGraphSchemaMessage,
  IdentityGraphStateBlocks,
  IdentityGraphIdentityList,
  IdentityGraphActiveIdentityCard,
  IdentityGraphIdentityCardsList,
  IdentityGraphLinkEditorDrawer,
  AccountRelationsSection,
  ProfileRelationsSection,
  AuthMethodsSection,
  AccountAuthLinksSection,
  getServiceBadgeClass,
  getLinkTypeBadgeClass } from
'./identity-graph';
import {
  normalizeSheetName,
  resolveIdentityName,
  ensureServiceList } from
'@/hooks/useIdentityGraphPanel';

export function IdentityGraphPanel(props: UseIdentityGraphPanelProps) {
  const p = useIdentityGraphPanel(props);

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', props.className)}>
      <IdentityGraphHeader
        totalIdentities={p.totalIdentities}
        totalServices={p.services.length}
        totalLinks={p.totalLinks}
        connectionReady={p.connectionReady}
        schemaStatus={p.schemaStatus}
        query={p.query}
        serviceFilter={p.serviceFilter}
        statusFilter={p.statusFilter}
        serviceOptions={p.serviceOptions}
        statusOptions={p.statusOptions}
        onInitSchema={p.handleInitSchema}
        onCreateLink={() => p.openCreateEditor(p.activeIdentity?.id)}
        onQueryChange={p.setQuery}
        onServiceFilterChange={(value) => p.setServiceFilter(value)}
        onStatusFilterChange={(value) => p.setStatusFilter(value)} />


      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        <IdentityGraphAlerts schemaIssues={p.schemaIssues} invalidRows={p.invalidRows} />
        <IdentityGraphDiagnostics diagnostics={p.filteredUnified.diagnostics} />
        <IdentityGraphSchemaMessage schemaMessage={p.schemaMessage} schemaStatus={p.schemaStatus} />
        <IdentityGraphStateBlocks
          isLoading={!!props.isLoading}
          error={props.error}
          hasData={p.hasData}
          onRetry={props.onRetry} />


        <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,360px)_1fr] gap-4">
          <IdentityGraphIdentityList
            identities={p.filteredIdentities}
            activeIdentityId={p.activeIdentity?.id ?? null}
            parsedLinks={p.parsedLinks}
            onSelectIdentity={p.setActiveIdentityId}
            resolveIdentityName={resolveIdentityName} />


          <div className="space-y-3">
            <IdentityGraphActiveIdentityCard
              activeIdentity={p.activeIdentity}
              activeIdentityLinks={p.activeIdentityLinks}
              activeIdentityUnifiedEdges={p.activeIdentityUnifiedEdges}
              services={p.services}
              connectionReady={p.connectionReady}
              onAddLink={p.openCreateEditor}
              onEditLink={p.openEditEditor}
              resolveIdentityName={resolveIdentityName}
              normalizeSheetName={normalizeSheetName}
              getLinkTypeBadgeClass={getLinkTypeBadgeClass} />

            <IdentityGraphIdentityCardsList
              identities={p.filteredIdentities}
              resolvedDataset={p.resolvedDataset}
              ensureServiceList={ensureServiceList}
              resolveIdentityName={resolveIdentityName}
              getServiceBadgeClass={getServiceBadgeClass} />


            <AccountRelationsSection
              accountRelationState={p.accountRelationState}
              setAccountRelationState={p.setAccountRelationState}
              accountOptions={p.accountOptions}
              handleSaveAccountRelation={p.handleSaveAccountRelation}
              handleDeleteAccountRelation={p.handleDeleteAccountRelation}
              accountLinks={p.accountLinks}
              deletingAccountRelationId={p.deletingAccountRelationId}
              savingAccountRelation={p.savingAccountRelation}
              connectionReady={p.connectionReady} />


            <ProfileRelationsSection
              profileRelationState={p.profileRelationState}
              setProfileRelationState={p.setProfileRelationState}
              profileOptions={p.profileOptions}
              accountOptions={p.accountOptions}
              handleSaveProfileRelation={p.handleSaveProfileRelation}
              handleDeleteProfileRelation={p.handleDeleteProfileRelation}
              profileLinks={p.profileLinks}
              deletingProfileRelationId={p.deletingProfileRelationId}
              savingProfileRelation={p.savingProfileRelation}
              connectionReady={p.connectionReady} />


            <AuthMethodsSection
              authMethodState={p.authMethodState}
              setAuthMethodState={p.setAuthMethodState}
              accountOptions={p.accountOptions}
              handleSaveAuthMethod={p.handleSaveAuthMethod}
              handleDeleteAuthMethod={p.handleDeleteAuthMethod}
              authMethods={p.authMethods}
              deletingAuthMethodId={p.deletingAuthMethodId}
              savingAuthMethod={p.savingAuthMethod}
              connectionReady={p.connectionReady}
              applyCodexApiPreset={p.applyCodexApiPreset}
              applyCodexBrowserPreset={p.applyCodexBrowserPreset}
              applyQuickFillFromActiveIdentity={p.applyQuickFillFromActiveIdentity} />


            <AccountAuthLinksSection
              accountAuthLinkState={p.accountAuthLinkState}
              setAccountAuthLinkState={p.setAccountAuthLinkState}
              accountOptions={p.accountOptions}
              profileOptions={p.profileOptions}
              authMethods={p.authMethods}
              handleSaveAccountAuthLink={p.handleSaveAccountAuthLink}
              handleDeleteAccountAuthLink={p.handleDeleteAccountAuthLink}
              accountAuthLinks={p.accountAuthLinks}
              deletingAccountAuthLinkId={p.deletingAccountAuthLinkId}
              savingAccountAuthLink={p.savingAccountAuthLink}
              connectionReady={p.connectionReady}
              authMethodById={p.authMethodById} />


            <div className="rounded-xl border border-white/10 bg-vsc-sidebar/80 p-4 space-y-2">
              <div className="text-xs text-slate-400">{t("accounts.identity_graph_panel.authaware_edges_in_graph_now_include")}

                <span className="ml-2 text-slate-200">{t("accounts.identity_graph_panel.accounttoauthmethod")}</span>
                <span className="ml-2 text-slate-200">{t("accounts.identity_graph_panel.authmethodtoprofile")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  label="Graph auth edges"
                  value={p.authEdgeFilter}
                  onValueChange={(value) =>
                  p.setAuthEdgeFilter(value as 'all' | 'auth_only' | 'no_auth' || 'all')
                  }
                  options={[
                  { value: 'all', label: 'all edges' },
                  { value: 'auth_only', label: 'auth edges only' },
                  { value: 'no_auth', label: 'without auth edges' }]
                  } />

                <div className="text-[11px] text-slate-500">{t("accounts.identity_graph_panel.showing")}
                  {p.filteredUnified.edges.length}{t("accounts.identity_graph_panel.edges")}{p.filteredUnified.nodes.length}{' '}{t("accounts.identity_graph_panel.nodes")}

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <IdentityGraphLinkEditorDrawer
        open={p.editorOpen}
        editorMode={p.editorMode}
        editorState={p.editorState}
        identityOptions={p.identityOptions}
        serviceSheetOptions={p.serviceSheetOptions}
        currentSheetServiceOptions={p.currentSheetServiceOptions}
        savingLink={p.savingLink}
        deletingLink={p.deletingLink}
        onClose={() => p.setEditorOpen(false)}
        onIdentityChange={(value) => p.setEditorState((prev) => ({ ...prev, fromIdentityId: value }))}
        onServiceSheetChange={(sheet) => {
          const firstService = p.servicesBySheet.get(sheet)?.[0]?.id || '';
          p.setEditorState((prev) => ({
            ...prev,
            toServiceSheet: sheet,
            toServiceAccountId: firstService
          }));
        }}
        onServiceAccountChange={(value) =>
        p.setEditorState((prev) => ({ ...prev, toServiceAccountId: value }))
        }
        onLinkTypeChange={(value) => p.setEditorState((prev) => ({ ...prev, linkType: value }))}
        onStatusChange={(value) => p.setEditorState((prev) => ({ ...prev, status: value }))}
        onNoteChange={(value) => p.setEditorState((prev) => ({ ...prev, note: value }))}
        onPrimaryChange={(checked) => p.setEditorState((prev) => ({ ...prev, isPrimary: checked }))}
        onDelete={p.handleDeleteLink}
        onSave={p.handleSaveLink} />

    </div>);

}