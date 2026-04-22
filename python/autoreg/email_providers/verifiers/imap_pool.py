"""Thread-safe IMAP connection pool"""

import imaplib
import threading
import logging
from queue import Queue, Empty
from contextlib import contextmanager
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class ImapConnectionPool:
    """Thread-safe connection pool for IMAP connections"""
    
    def __init__(self, config: Dict[str, Any], pool_size: int = 3):
        """
        Initialize connection pool
        
        Args:
            config: IMAP config with keys: host, port, user, password
            pool_size: Maximum number of connections in pool
        """
        self.config = config
        self.pool_size = pool_size
        self.pool: Queue = Queue(maxsize=pool_size)
        self.lock = threading.Lock()
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazily create initial connections on first use"""
        with self.lock:
            if not self._initialized:
                self._initialized = True
                self._initialize_pool()
    
    def _initialize_pool(self):
        """Create initial connections"""
        for _ in range(self.pool_size):
            conn = self._create_connection()
            if conn:
                self.pool.put(conn)
    
    def _create_connection(self) -> Optional[imaplib.IMAP4_SSL]:
        """Create new IMAP connection"""
        try:
            mail = imaplib.IMAP4_SSL(
                self.config['host'],
                self.config.get('port', 993),
                timeout=10
            )
            mail.login(self.config['user'], self.config['password'])
            mail.select('INBOX')
            logger.info(f"Created IMAP connection to {self.config['host']}")
            return mail
        except Exception as e:
            logger.error(f"Failed to create IMAP connection: {e}")
            return None
    
    @contextmanager
    def get_connection(self, timeout: float = 5.0):
        """
        Get connection from pool (context manager)
        
        Usage:
            with pool.get_connection() as mail:
                mail.search(None, 'ALL')
        
        Args:
            timeout: Timeout in seconds to wait for available connection
            
        Yields:
            IMAP connection from pool
        """
        conn = None
        try:
            # Ensure pool connections are created on first use
            self._ensure_initialized()
            # Try to get from pool
            conn = self.pool.get(timeout=timeout)
            
            # Check if connection is alive
            try:
                conn.noop()
            except:
                # Connection dead, create new one
                logger.warning("Connection dead, creating new one")
                try:
                    conn.logout()
                except:
                    pass
                conn = self._create_connection()
            
            yield conn
        finally:
            # Return to pool
            if conn:
                try:
                    self.pool.put(conn, timeout=1.0)
                except:
                    # Pool full, close connection
                    try:
                        conn.logout()
                    except:
                        pass
    
    def close_all(self):
        """Close all connections in pool"""
        while not self.pool.empty():
            try:
                conn = self.pool.get_nowait()
                conn.logout()
            except:
                pass
        logger.info("All IMAP connections closed")
