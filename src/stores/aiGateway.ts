import { create } from 'zustand';
import type {
  ProviderEndpoint,
  Credential,
  UpstreamModel,
  CredentialModelAccess,
  PublicModel,
  RouteTarget,
} from '@/lib/backend/modules/aiGateway';
import * as api from '@/lib/backend/modules/aiGateway';

interface AiGatewayState {
  // Data
  endpoints: ProviderEndpoint[];
  credentials: Credential[];
  upstreamModels: UpstreamModel[];
  credentialModelAccess: CredentialModelAccess[];
  publicModels: PublicModel[];
  routeTargets: RouteTarget[];

  // Loading states
  loading: {
    endpoints: boolean;
    credentials: boolean;
    upstreamModels: boolean;
    credentialModelAccess: boolean;
    publicModels: boolean;
    routeTargets: boolean;
  };

  // Errors
  errors: {
    endpoints: string | null;
    credentials: string | null;
    upstreamModels: string | null;
    credentialModelAccess: string | null;
    publicModels: string | null;
    routeTargets: string | null;
  };

  // Actions
  fetchEndpoints: () => Promise<void>;
  fetchCredentials: (endpointId?: string) => Promise<void>;
  fetchUpstreamModels: (endpointId?: string) => Promise<void>;
  fetchCredentialModelAccess: (credentialId?: string, modelId?: string) => Promise<void>;
  fetchPublicModels: () => Promise<void>;
  fetchRouteTargets: (publicModelId: string) => Promise<void>;

  createEndpoint: (params: Parameters<typeof api.createProviderEndpoint>[0]) => Promise<ProviderEndpoint>;
  updateEndpoint: (params: Parameters<typeof api.updateProviderEndpoint>[0]) => Promise<ProviderEndpoint | null>;
  deleteEndpoint: (id: string) => Promise<void>;

  createCredential: (params: Parameters<typeof api.createCredential>[0]) => Promise<Credential>;
  updateCredential: (params: Parameters<typeof api.updateCredential>[0]) => Promise<Credential | null>;
  deleteCredential: (id: string) => Promise<void>;
  rotateSecret: (params: Parameters<typeof api.rotateCredentialSecret>[0]) => Promise<Credential | null>;

  createUpstreamModel: (params: Parameters<typeof api.createUpstreamModel>[0]) => Promise<UpstreamModel>;
  updateUpstreamModel: (params: Parameters<typeof api.updateUpstreamModel>[0]) => Promise<UpstreamModel | null>;
  deleteUpstreamModel: (id: string) => Promise<void>;

  upsertCredentialModelAccess: (params: Parameters<typeof api.upsertCredentialModelAccess>[0]) => Promise<CredentialModelAccess>;
  deleteCredentialModelAccess: (id: number) => Promise<void>;

  createPublicModel: (params: Parameters<typeof api.createPublicModel>[0]) => Promise<PublicModel>;
  updatePublicModel: (params: Parameters<typeof api.updatePublicModel>[0]) => Promise<PublicModel | null>;
  deletePublicModel: (id: string) => Promise<void>;

  createRouteTarget: (params: Parameters<typeof api.createRouteTarget>[0]) => Promise<RouteTarget>;
  updateRouteTarget: (params: Parameters<typeof api.updateRouteTarget>[0]) => Promise<RouteTarget | null>;
  deleteRouteTarget: (id: number) => Promise<void>;

  migrateLegacyData: () => Promise<{ endpoints_created: number; credentials_created: number }>;
}

export const useAiGatewayStore = create<AiGatewayState>((set) => ({
  endpoints: [],
  credentials: [],
  upstreamModels: [],
  credentialModelAccess: [],
  publicModels: [],
  routeTargets: [],

  loading: {
    endpoints: false,
    credentials: false,
    upstreamModels: false,
    credentialModelAccess: false,
    publicModels: false,
    routeTargets: false,
  },

  errors: {
    endpoints: null,
    credentials: null,
    upstreamModels: null,
    credentialModelAccess: null,
    publicModels: null,
    routeTargets: null,
  },

  fetchEndpoints: async () => {
    set(s => ({ loading: { ...s.loading, endpoints: true }, errors: { ...s.errors, endpoints: null } }));
    try {
      const endpoints = await api.listProviderEndpoints();
      set({ endpoints });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, endpoints: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, endpoints: false } }));
    }
  },

  fetchCredentials: async (endpointId?: string) => {
    set(s => ({ loading: { ...s.loading, credentials: true }, errors: { ...s.errors, credentials: null } }));
    try {
      const credentials = await api.listCredentials(endpointId);
      set({ credentials });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, credentials: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, credentials: false } }));
    }
  },

  fetchUpstreamModels: async (endpointId?: string) => {
    set(s => ({ loading: { ...s.loading, upstreamModels: true }, errors: { ...s.errors, upstreamModels: null } }));
    try {
      const upstreamModels = await api.listUpstreamModels(endpointId);
      set({ upstreamModels });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, upstreamModels: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, upstreamModels: false } }));
    }
  },

  fetchCredentialModelAccess: async (credentialId?: string, modelId?: string) => {
    set(s => ({ loading: { ...s.loading, credentialModelAccess: true }, errors: { ...s.errors, credentialModelAccess: null } }));
    try {
      const credentialModelAccess = await api.listCredentialModelAccess({ credentialId, upstreamModelId: modelId });
      set({ credentialModelAccess });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, credentialModelAccess: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, credentialModelAccess: false } }));
    }
  },

  fetchPublicModels: async () => {
    set(s => ({ loading: { ...s.loading, publicModels: true }, errors: { ...s.errors, publicModels: null } }));
    try {
      const publicModels = await api.listPublicModels();
      set({ publicModels });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, publicModels: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, publicModels: false } }));
    }
  },

  fetchRouteTargets: async (publicModelId: string) => {
    set(s => ({ loading: { ...s.loading, routeTargets: true }, errors: { ...s.errors, routeTargets: null } }));
    try {
      const routeTargets = await api.listRouteTargetsForPublicModel(publicModelId);
      set({ routeTargets });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, routeTargets: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, routeTargets: false } }));
    }
  },

  createEndpoint: async (params) => {
    const endpoint = await api.createProviderEndpoint(params);
    set(s => ({ endpoints: [...s.endpoints, endpoint] }));
    return endpoint;
  },

  updateEndpoint: async (params) => {
    const endpoint = await api.updateProviderEndpoint(params);
    if (endpoint) {
      set(s => ({ endpoints: s.endpoints.map(e => e.id === endpoint.id ? endpoint : e) }));
    }
    return endpoint;
  },

  deleteEndpoint: async (id) => {
    await api.deleteProviderEndpoint(id);
    set(s => ({ endpoints: s.endpoints.filter(e => e.id !== id) }));
  },

  createCredential: async (params) => {
    const credential = await api.createCredential(params);
    set(s => ({ credentials: [...s.credentials, credential] }));
    return credential;
  },

  updateCredential: async (params) => {
    const credential = await api.updateCredential(params);
    if (credential) {
      set(s => ({ credentials: s.credentials.map(c => c.id === credential.id ? credential : c) }));
    }
    return credential;
  },

  deleteCredential: async (id) => {
    await api.deleteCredential(id);
    set(s => ({ credentials: s.credentials.filter(c => c.id !== id) }));
  },

  rotateSecret: async (params) => {
    const credential = await api.rotateCredentialSecret(params);
    if (credential) {
      set(s => ({ credentials: s.credentials.map(c => c.id === credential.id ? credential : c) }));
    }
    return credential;
  },

  createUpstreamModel: async (params) => {
    const model = await api.createUpstreamModel(params);
    set(s => ({ upstreamModels: [...s.upstreamModels, model] }));
    return model;
  },

  updateUpstreamModel: async (params) => {
    const model = await api.updateUpstreamModel(params);
    if (model) {
      set(s => ({ upstreamModels: s.upstreamModels.map(m => m.id === model.id ? model : m) }));
    }
    return model;
  },

  deleteUpstreamModel: async (id) => {
    await api.deleteUpstreamModel(id);
    set(s => ({ upstreamModels: s.upstreamModels.filter(m => m.id !== id) }));
  },

  upsertCredentialModelAccess: async (params) => {
    const access = await api.upsertCredentialModelAccess(params);
    set(s => ({
      credentialModelAccess: [
        ...s.credentialModelAccess.filter(a => !(a.credentialId === access.credentialId && a.upstreamModelId === access.upstreamModelId)),
        access,
      ],
    }));
    return access;
  },

  deleteCredentialModelAccess: async (id) => {
    await api.deleteCredentialModelAccess(id);
    set(s => ({ credentialModelAccess: s.credentialModelAccess.filter(a => a.id !== id) }));
  },

  createPublicModel: async (params) => {
    const model = await api.createPublicModel(params);
    set(s => ({ publicModels: [...s.publicModels, model] }));
    return model;
  },

  updatePublicModel: async (params) => {
    const model = await api.updatePublicModel(params);
    if (model) {
      set(s => ({ publicModels: s.publicModels.map(m => m.id === model.id ? model : m) }));
    }
    return model;
  },

  deletePublicModel: async (id) => {
    await api.deletePublicModel(id);
    set(s => ({ publicModels: s.publicModels.filter(m => m.id !== id) }));
  },

  createRouteTarget: async (params) => {
    const target = await api.createRouteTarget(params);
    set(s => ({ routeTargets: [...s.routeTargets, target] }));
    return target;
  },

  updateRouteTarget: async (params) => {
    const target = await api.updateRouteTarget(params);
    if (target) {
      set(s => ({ routeTargets: s.routeTargets.map(t => t.id === target.id ? target : t) }));
    }
    return target;
  },

  deleteRouteTarget: async (id) => {
    await api.deleteRouteTarget(id);
    set(s => ({ routeTargets: s.routeTargets.filter(t => t.id !== id) }));
  },

  migrateLegacyData: async () => {
    return await api.migrateLegacyData();
  },
}));
