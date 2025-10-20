"""
Marinesia API Client
Handles all interactions with the Marinesia API for vessel enrichment
"""
import httpx
import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class MarinesiaClient:
    def __init__(self, api_key: str, base_url: str = "https://api.marinesia.com/api/v1"):
        self.api_key = api_key
        self.base_url = base_url
        self.rate_limit_delay = 0.1  # 100ms between requests (10 req/sec)
        self.last_request_time = datetime.now()
        self.cache = {}  # Simple in-memory cache
        self.cache_ttl = timedelta(hours=24)  # Cache for 24 hours
        
    async def _rate_limit(self):
        """Implement rate limiting"""
        now = datetime.now()
        time_since_last = (now - self.last_request_time).total_seconds()
        if time_since_last < self.rate_limit_delay:
            await asyncio.sleep(self.rate_limit_delay - time_since_last)
        self.last_request_time = datetime.now()
    
    def _is_cached(self, cache_key: str) -> bool:
        """Check if data is in cache and still valid"""
        if cache_key in self.cache:
            cached_data, cached_time = self.cache[cache_key]
            if datetime.now() - cached_time < self.cache_ttl:
                return True
            else:
                del self.cache[cache_key]
        return False
    
    def _get_cached(self, cache_key: str) -> Optional[Dict]:
        """Get cached data"""
        if cache_key in self.cache:
            return self.cache[cache_key][0]
        return None
    
    def _set_cache(self, cache_key: str, data: Dict):
        """Set cache data"""
        self.cache[cache_key] = (data, datetime.now())
    
    async def get_vessel_profile(self, mmsi: str) -> Optional[Dict[str, Any]]:
        """Get vessel profile by MMSI"""
        cache_key = f"profile_{mmsi}"
        
        # Check cache first
        if self._is_cached(cache_key):
            logger.debug(f"Using cached profile for MMSI {mmsi}")
            return self._get_cached(cache_key)
        
        try:
            await self._rate_limit()
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/vessel/{mmsi}/profile",
                    params={"key": self.api_key}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    # Extract just the data field if it exists
                    if result.get('error') is False and result.get('data'):
                        data = result['data']
                        self._set_cache(cache_key, data)
                        logger.info(f"Successfully fetched profile for MMSI {mmsi}")
                        return data
                    return None
                elif response.status_code == 404:
                    logger.debug(f"Vessel profile not found for MMSI {mmsi}")
                    # Cache the 404 to avoid repeated requests
                    self._set_cache(cache_key, {'not_found': True})
                    return None
                else:
                    logger.warning(f"Marinesia API returned status {response.status_code} for MMSI {mmsi}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error fetching vessel profile for MMSI {mmsi}: {e}")
            return None
    
    async def get_vessel_image(self, mmsi: str) -> Optional[str]:
        """Get vessel image URL by MMSI"""
        cache_key = f"image_{mmsi}"
        
        if self._is_cached(cache_key):
            cached = self._get_cached(cache_key)
            if cached and cached != 'not_found':
                return cached
            return None
        
        try:
            await self._rate_limit()
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/vessel/{mmsi}/image",
                    params={"key": self.api_key}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    image_url = data.get('image_url') or data.get('url')
                    if image_url:
                        self._set_cache(cache_key, image_url)
                        return image_url
                
                # Cache not found
                self._set_cache(cache_key, 'not_found')
                return None
                
        except Exception as e:
            logger.error(f"Error fetching vessel image for MMSI {mmsi}: {e}")
            return None
    
    async def get_latest_location(self, mmsi: str) -> Optional[Dict[str, Any]]:
        """Get latest vessel location by MMSI"""
        cache_key = f"latest_location_{mmsi}"
        
        # Short cache for location (5 minutes)
        if cache_key in self.cache:
            cached_data, cached_time = self.cache[cache_key]
            if datetime.now() - cached_time < timedelta(minutes=5):
                return cached_data
            else:
                del self.cache[cache_key]
        
        try:
            await self._rate_limit()
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/vessel/{mmsi}/location/latest",
                    params={"key": self.api_key}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('error') is False and result.get('data'):
                        data = result['data']
                        self._set_cache(cache_key, data)
                        logger.info(f"Successfully fetched latest location for MMSI {mmsi}")
                        return data
                    return None
                elif response.status_code == 404:
                    logger.debug(f"Latest location not found for MMSI {mmsi}")
                    return None
                else:
                    logger.warning(f"Marinesia API returned status {response.status_code} for latest location {mmsi}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error fetching latest location for MMSI {mmsi}: {e}")
            return None
    
    async def get_historical_locations(self, mmsi: str, limit: int = 100, hours_back: int = 24) -> list:
        """Get historical vessel locations by MMSI"""
        cache_key = f"history_{mmsi}_{limit}_{hours_back}"
        
        # Cache historical data for 1 hour
        if cache_key in self.cache:
            cached_data, cached_time = self.cache[cache_key]
            if datetime.now() - cached_time < timedelta(hours=1):
                return cached_data
            else:
                del self.cache[cache_key]
        
        try:
            await self._rate_limit()
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/vessel/{mmsi}/location",
                    params={
                        "key": self.api_key,
                        "limit": limit
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('error') is False and result.get('data'):
                        data = result['data']
                        self._set_cache(cache_key, data)
                        logger.info(f"Successfully fetched {len(data)} historical locations for MMSI {mmsi}")
                        return data
                    return []
                elif response.status_code == 404:
                    logger.debug(f"Historical locations not found for MMSI {mmsi}")
                    return []
                else:
                    logger.warning(f"Marinesia API returned status {response.status_code} for history {mmsi}")
                    return []
                    
        except Exception as e:
            logger.error(f"Error fetching historical locations for MMSI {mmsi}: {e}")
            return []
    
    async def enrich_vessel(self, mmsi: str) -> Dict[str, Any]:
        """
        Comprehensive enrichment: fetch profile, image, and latest location
        Returns enriched data dictionary
        """
        enriched = {
            'mmsi': mmsi,
            'enriched_at': datetime.now().isoformat(),
            'profile': None,
            'image_url': None,
            'latest_location': None,
            'enriched': False
        }
        
        # Get profile
        profile = await self.get_vessel_profile(mmsi)
        if profile and not profile.get('not_found'):
            enriched['profile'] = profile
            enriched['enriched'] = True
            
            # Get image
            image_url = await self.get_vessel_image(mmsi)
            if image_url:
                enriched['image_url'] = image_url
            
            # Get latest location
            latest_location = await self.get_latest_location(mmsi)
            if latest_location:
                enriched['latest_location'] = latest_location
        
        return enriched
