use async_trait::async_trait;
use parking_lot::Mutex;
use pingora::prelude::*;
use rand::Rng;
use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Cấu trúc theo dõi chỉ số độ trễ Peak-EWMA và Active Connections cho từng Backend IP
pub struct NodeStats {
    pub active_conns: AtomicUsize,
    pub ewma_latency_ms: Mutex<f64>,
}

impl Default for NodeStats {
    fn default() -> Self {
        Self {
            active_conns: AtomicUsize::new(0),
            ewma_latency_ms: Mutex::new(15.0), // Khởi tạo 15ms
        }
    }
}

pub struct RequestContext {
    pub start_time: Instant,
    pub selected_addr: Option<String>,
}

pub struct OmniverseReverseProxy {
    upstream_target: String,
    stats_map: Arc<Mutex<HashMap<String, Arc<NodeStats>>>>,
}

impl OmniverseReverseProxy {
    pub fn new(upstream_target: String) -> Self {
        Self {
            upstream_target,
            stats_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn get_or_create_stats(&self, addr: &str) -> Arc<NodeStats> {
        let mut map = self.stats_map.lock();
        map.entry(addr.to_string())
            .or_insert_with(|| Arc::new(NodeStats::default()))
            .clone()
    }
}

#[async_trait]
impl ProxyHttp for OmniverseReverseProxy {
    type CTX = RequestContext;

    fn new_ctx(&self) -> Self::CTX {
        RequestContext {
            start_time: Instant::now(),
            selected_addr: None,
        }
    }

    async fn upstream_peer(
        &self,
        _session: &mut Session,
        ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        // 1. Phân giải danh sách IP động (Dynamic DNS Discovery) trên Swarm Overlay Network
        let addrs: Vec<SocketAddr> = match tokio::net::lookup_host(&self.upstream_target).await {
            Ok(iter) => iter.collect(),
            Err(_) => Vec::new(),
        };

        let selected_target = if addrs.len() >= 2 {
            // 2. Thuật toán P2C (Power of Two Choices): Bốc ngẫu nhiên 2 node ứng viên
            let mut rng = rand::thread_rng();
            let idx1 = rng.gen_range(0..addrs.len());
            let mut idx2 = rng.gen_range(0..addrs.len());
            while idx2 == idx1 {
                idx2 = rng.gen_range(0..addrs.len());
            }

            let a1 = addrs[idx1].to_string();
            let a2 = addrs[idx2].to_string();

            let s1 = self.get_or_create_stats(&a1);
            let s2 = self.get_or_create_stats(&a2);

            // Load Score = (ActiveConns + 1) * EWMA_Latency
            let conns1 = s1.active_conns.load(Ordering::Relaxed) as f64;
            let conns2 = s2.active_conns.load(Ordering::Relaxed) as f64;
            let ewma1 = *s1.ewma_latency_ms.lock();
            let ewma2 = *s2.ewma_latency_ms.lock();

            let score1 = (conns1 + 1.0) * ewma1;
            let score2 = (conns2 + 1.0) * ewma2;

            if score1 <= score2 {
                a1
            } else {
                a2
            }
        } else if !addrs.is_empty() {
            addrs[0].to_string()
        } else {
            self.upstream_target.clone()
        };

        ctx.selected_addr = Some(selected_target.clone());

        // Tăng Active Connections
        let stats = self.get_or_create_stats(&selected_target);
        stats.active_conns.fetch_add(1, Ordering::SeqCst);

        let peer = Box::new(HttpPeer::new(selected_target, false, "".to_string()));
        Ok(peer)
    }

    async fn response_filter(
        &self,
        _session: &mut Session,
        upstream_response: &mut ResponseHeader,
        _ctx: &mut Self::CTX,
    ) -> Result<()> {
        let _ = upstream_response.insert_header("Server", "Pingora/Cloudflare-Rust");
        let _ = upstream_response.insert_header("X-Proxy-By", "Pingora-Omniverse-Tool");
        let _ = upstream_response.insert_header("X-Backend-Engine", "Golang-Native-Core");
        let _ = upstream_response.insert_header("X-LB-Algorithm", "P2C-Peak-EWMA-Dynamic");
        Ok(())
    }

    async fn logging(
        &self,
        _session: &mut Session,
        _e: Option<&pingora::Error>,
        ctx: &mut Self::CTX,
    ) {
        // Cập nhật Peak-EWMA Latency sau khi request kết thúc
        if let Some(ref addr) = ctx.selected_addr {
            let elapsed_ms = ctx.start_time.elapsed().as_secs_f64() * 1000.0;
            let stats = self.get_or_create_stats(addr);

            // Giảm Active Connections
            stats.active_conns.fetch_sub(1, Ordering::SeqCst);

            // Công thức EWMA: alpha = 0.2
            let alpha = 0.2;
            let mut ewma = stats.ewma_latency_ms.lock();
            *ewma = alpha * elapsed_ms + (1.0 - alpha) * (*ewma);
        }
    }
}

fn main() {
    env_logger::init();
    println!("🚀 [PINGORA] Đang khởi động Cloudflare Pingora với Thuật toán P2C + PEAK-EWMA + DYNAMIC DNS...");

    let mut server = Server::new(None).expect("Khởi tạo Pingora Server thất bại");
    server.bootstrap();

    let upstream = env::var("UPSTREAM_ADDR").unwrap_or_else(|_| "app:8000".to_string());
    println!("🔗 [PINGORA] Upstream Target: {}", upstream);

    let mut proxy_service = http_proxy_service(
        &server.configuration,
        OmniverseReverseProxy::new(upstream),
    );

    // Lắng nghe trên Port 80
    proxy_service.add_tcp("0.0.0.0:80");
    println!("🌐 [PINGORA] Reverse Proxy đang lắng nghe tại http://0.0.0.0:80 (Thuật toán: P2C + Peak-EWMA)");

    server.add_service(proxy_service);
    server.run_forever();
}
