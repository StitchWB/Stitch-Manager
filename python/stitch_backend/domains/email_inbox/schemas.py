"""Email Inbox Pydantic schemas — DTOs matching frontend TypeScript types.

All aliases use camelCase to match the Rust/Specta-generated TS types.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ── Provider types ────────────────────────────────────────────────────────────

class ImapConnectCredentials(BaseModel):
    host: str
    port: int = 993
    username: str
    password: str
    use_tls: bool = Field(True, alias="useTls")


class MailTmConnectCredentials(BaseModel):
    address: str
    password: str
    base_url: str | None = Field(None, alias="baseUrl")


class EmailConnectInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str  # "imap" | "mail_tm"
    account_id: str = Field(alias="accountId")
    credentials: dict[str, Any]  # { type: "imap"|"mail_tm", value: {...} }
    options: dict[str, Any] | None = None


# ── Session / capabilities ────────────────────────────────────────────────────

class ProviderCapabilities(BaseModel):
    can_delete: bool = Field(False, alias="canDelete")
    can_mark_as_read: bool = Field(False, alias="canMarkAsRead")
    can_search_body: bool = Field(False, alias="canSearchBody")
    can_download_attachments: bool = Field(False, alias="canDownloadAttachments")
    can_list_folders: bool = Field(False, alias="canListFolders")


class EmailMailboxSession(BaseModel):
    session_id: str = Field(alias="sessionId")
    provider: str
    account_id: str = Field(alias="accountId")
    capabilities: ProviderCapabilities
    connected_at: str = Field(alias="connectedAt")


# ── Email message ─────────────────────────────────────────────────────────────

class EmailAddress(BaseModel):
    name: str | None = None
    email: str


class EmailAttachment(BaseModel):
    id: str
    filename: str
    content_type: str = Field(alias="contentType")
    size: int


class EmailMessage(BaseModel):
    id: str
    provider_message_id: str = Field(alias="providerMessageId")
    from_: EmailAddress = Field(alias="from")
    to: list[EmailAddress] = []
    cc: list[EmailAddress] = []
    bcc: list[EmailAddress] = []
    subject: str = ""
    text: str | None = None
    html: str | None = None
    headers: dict[str, str] = {}
    attachments: list[EmailAttachment] = []
    is_read: bool = Field(False, alias="isRead")
    received_at: str = Field("", alias="receivedAt")


# ── Query / options ───────────────────────────────────────────────────────────

class EmailQuery(BaseModel):
    from_: str | None = Field(None, alias="from")
    to: str | None = None
    subject_contains: str | None = Field(None, alias="subjectContains")
    body_contains: str | None = Field(None, alias="bodyContains")
    search: str | None = None
    unread_only: bool | None = Field(None, alias="unreadOnly")
    since: str | None = None
    limit: int | None = None


class WaitForEmailOptions(BaseModel):
    timeout_ms: int | None = Field(None, alias="timeoutMs")
    poll_interval_ms: int | None = Field(None, alias="pollIntervalMs")
    dedupe_key: str | None = Field(None, alias="dedupeKey")


# ── Folder ────────────────────────────────────────────────────────────────────

class EmailFolder(BaseModel):
    id: str
    path: str
    name: str
    kind: str  # "inbox" | "sent" | "drafts" | "trash" | "spam" | ...
    delimiter: str | None = None


# ── Profile ───────────────────────────────────────────────────────────────────

class EmailInboxProfile(BaseModel):
    id: str
    label: str
    provider: str
    account_id: str = Field(alias="accountId")
    connect_input: dict[str, Any] = Field(alias="connectInput")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class EmailInboxProfileUpsertInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str | None = None
    label: str | None = None
    connect_input: EmailConnectInput = Field(alias="connectInput")


# ── Sync state ────────────────────────────────────────────────────────────────

class EmailInboxSyncState(BaseModel):
    profile_id: str = Field(alias="profileId")
    status: str  # "idle" | "syncing" | "error"
    last_sync_at: str | None = Field(None, alias="lastSyncAt")
    last_error: str | None = Field(None, alias="lastError")
    cursor: str | None = None
    updated_at: str = Field(alias="updatedAt")


class EmailInboxSyncStateUpsertInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    profile_id: str = Field(alias="profileId")
    status: str
    last_sync_at: str | None = Field(None, alias="lastSyncAt")
    last_error: str | None = Field(None, alias="lastError")
    cursor: str | None = None


# ── Provider catalog ──────────────────────────────────────────────────────────

class EmailProviderCatalogItem(BaseModel):
    provider: str
    display_name: str = Field(alias="displayName")
    available: bool
    capabilities: ProviderCapabilities
    supports_profile_connect: bool = Field(True, alias="supportsProfileConnect")
