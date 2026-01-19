import os
import re
import json
import hashlib
import time
from pathlib import Path
from urllib.parse import urlparse
from typing import Optional, List, Dict, Any

class ScriptCollector:
    """
    Класс для сбора и сохранения JavaScript файлов из браузера.
    Использует DrissionPage listen() для перехвата сетевых запросов.
    """
    def __init__(self, output_dir: Optional[str] = None):
        if output_dir is None:
            # По умолчанию сохраняем в prepared-area/collected-scripts
            root = Path(__file__).parent.parent.parent.parent.parent
            self.output_dir = root / "prepared-area" / "collected-scripts"
        else:
            self.output_dir = Path(output_dir)
            
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.output_dir / "manifest.json"
        self.manifest = self._load_manifest()
        self.collected_hashes = set(self.manifest.keys())
        self.collected_urls = set(item["url"] for item in self.manifest.values())

    def _load_manifest(self) -> Dict[str, Any]:
        if self.manifest_path.exists():
            try:
                with open(self.manifest_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return dict(data) if data else {}
            except Exception:
                return {}
        return {}

    def _save_manifest(self):
        with open(self.manifest_path, 'w', encoding='utf-8') as f:
            json.dump(self.manifest, f, indent=2, ensure_ascii=False)

    def start_listening(self, page):
        """Включает прослушивание сетевых запросов для перехвата JS"""
        try:
            # Не ограничиваем targets, будем фильтровать сами в collect_from_listen
            page.listen.start()
            print("[ScriptCollector] Started listening for all network traffic...")
        except Exception as e:
            print(f"[ScriptCollector] Error starting listen: {e}")

    def collect_from_listen(self, page):
        """Собирает перехваченные через listen() скрипты"""
        try:
            # Пытаемся собрать пакеты быстро, чтобы не блокировать основной поток
            count = 0
            max_packets_per_call = 50 # Ограничиваем количество за один вызов
            
            while count < max_packets_per_call:
                # Используем минимальный таймаут
                packet = page.listen.wait(timeout=0.01)
                if not packet:
                    break
                
                count += 1
                url = packet.url
                
                # Фильтруем JS
                is_js = ('.js' in url.lower() or 
                         packet.resourceType == 'Script' or 
                         (packet.response and 'javascript' in (packet.response.headers.get('Content-Type', '').lower())))
                
                if is_js and url not in self.collected_urls:
                    try:
                        content = packet.response.body
                        if content:
                            if isinstance(content, str):
                                content = content.encode('utf-8')
                            self._save_script(url, content)
                            self.collected_urls.add(url)
                    except Exception:
                        pass
            
            if count > 0:
                self._save_manifest() # Сохраняем один раз после пачки
        except Exception:
            pass

    def collect_from_page(self, page):
        """
        Собирает все скрипты с текущей страницы (DOM + Listen).
        """
        # Сначала собираем то, что перехватили через listen
        self.collect_from_listen(page)
        
        # Затем ищем инлайновые скрипты в DOM
        try:
            scripts = page.eles('tag:script')
            for i, script in enumerate(scripts):
                src = script.attr('src')
                if src:
                    # Внешний скрипт, если он не был перехвачен через listen
                    if src not in self.collected_urls:
                        # Мы не можем легко получить контент внешнего скрипта через DOM без запроса
                        # Но он должен был попасть в listen()
                        pass
                else:
                    # Инлайновый скрипт
                    text = script.text
                    if text and len(text) > 50: # Игнорируем совсем короткие
                        url = f"inline://{page.url}#script_{i}"
                        if url not in self.collected_urls:
                            self._save_script(url, text.encode('utf-8'), is_inline=True)
                            self.collected_urls.add(url)
            
            # Сохраняем манифест после всех изменений
            self._save_manifest()
        except Exception:
            pass

    def _collect_inline_script(self, page_url: str, content: str):
        """Сохраняет инлайновый скрипт"""
        if isinstance(content, str):
            content_bytes = content.encode('utf-8')
        else:
            content_bytes = content
            
        self._save_script(f"inline_from_{page_url}", content_bytes, is_inline=True)

    def _save_script(self, url: str, content: bytes, is_inline: bool = False):
        if not content:
            return
            
        sha256 = hashlib.sha256(content).hexdigest()
        
        if sha256 in self.collected_hashes:
            return

        # Генерируем имя файла
        parsed = urlparse(url)
        path_part = parsed.path
        filename = os.path.basename(path_part)
        
        if not filename or not filename.endswith('.js'):
            if is_inline:
                filename = f"inline_{sha256[:8]}.js"
            else:
                filename = f"script_{sha256[:8]}.js"
        else:
            # Добавляем хэш чтобы избежать коллизий имен
            name_part, ext = os.path.splitext(filename)
            filename = f"{name_part}_{sha256[:8]}{ext}"

        filepath = self.output_dir / filename
        try:
            with open(filepath, 'wb') as f:
                f.write(content)

            # Обновляем манифест
            self.manifest[sha256] = {
                "url": url,
                "filename": filename,
                "size": len(content),
                "is_inline": is_inline,
                "timestamp": time.time()
            }
            self.collected_hashes.add(sha256)
            # manifest saved in caller
            print(f"[ScriptCollector] Saved: {filename} ({len(content)} bytes) from {url[:50]}...")
        except Exception as e:
            print(f"[ScriptCollector] Failed to save {filename}: {e}")

# Singleton instance
_collector = None

def get_collector():
    global _collector
    if _collector is None:
        _collector = ScriptCollector()
    return _collector

def collect_scripts(page):
    get_collector().collect_from_page(page)

def start_collecting(page):
    get_collector().start_listening(page)

def save_collected_scripts():
    # Манифест сохраняется автоматически
    pass
