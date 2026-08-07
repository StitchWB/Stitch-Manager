"""
Спуфинг Storage API

Подменяет navigator.storage.estimate и indexedDB.databases.
Предотвращает обнаружение пустых хранилищ и лимитов диска.
"""

from .base import BaseSpoofModule


class StorageSpoofModule(BaseSpoofModule):
    """Спуфинг Storage API"""

    name = "storage"
    description = "Spoof storage estimate and indexedDB databases"

    def get_js(self) -> str:
        return '''
(function() {
    'use strict';

    // ============================================
    // navigator.storage.estimate
    // ============================================
    if (navigator.storage && navigator.storage.estimate) {
        const originalEstimate = navigator.storage.estimate;
        navigator.storage.estimate = function() {
            return Promise.resolve({
                quota: 100 * 1024 * 1024 * 1024, // 100 GB
                usage: 10 * 1024 * 1024,          // 10 MB
                usageDetails: {
                    indexedDB: 5 * 1024 * 1024,
                    cacheStorage: 5 * 1024 * 1024
                }
            });
        };
    }

    // ============================================
    // indexedDB.databases()
    // ============================================
    if (window.indexedDB && window.indexedDB.databases) {
        const originalDatabases = window.indexedDB.databases;
        window.indexedDB.databases = function() {
            // Возвращаем пустой список, чтобы не палить старые сессии
            // (В DrissionPage инкогнито и так пуст, но на всякий случай)
            return Promise.resolve([]);
        };
    }

    // ============================================
    // Permissions API (query)
    // Это ПОСЛЕДНИЙ модуль в цепочке, поэтому именно эта обёртка wins.
    // Спуфим toString, чтобы anti-bot, проверяющий сигнатуру "[native code]",
    // не увидел JS-override (обычная функция сразу палится).
    // ============================================
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query;
        const spoofedQuery = function query(parameters) {
            // Всегда возвращаем 'granted' или 'prompt' для важных пермишенов
            if (parameters && parameters.name === 'notifications') {
                return Promise.resolve({ state: 'prompt', onchange: null });
            }
            if (parameters && parameters.name === 'geolocation') {
                return Promise.resolve({ state: 'prompt', onchange: null });
            }
            return originalQuery.call(navigator.permissions, parameters);
        };
        try {
            Object.defineProperty(spoofedQuery, 'toString', {
                value: () => 'function query() { [native code] }',
                configurable: true, writable: true
            });
            Object.defineProperty(spoofedQuery, 'name', { value: 'query', configurable: true });
            Object.defineProperty(spoofedQuery, 'length', { value: 1, configurable: true });
        } catch(e) {}
        navigator.permissions.query = spoofedQuery;
    }

})();
'''
