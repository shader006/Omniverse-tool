package main

import (
	"net/http"

	delivery "omniverse_backend/internal/delivery/http"
	"omniverse_backend/internal/infrastructure/cache"
	"omniverse_backend/internal/infrastructure/worker"
	"omniverse_backend/internal/service"
)

// Server đóng vai trò Application Facade kết nối các tầng (Layers)
type Server struct {
	pogo           *cache.PogocacheEngine
	gotenbergLB    *worker.GotenbergLoadBalancer
	downloadDir    string
	frontendDir    string
	mediaLimiter   chan struct{}
	httpClient     *http.Client
	httpLongClient *http.Client

	// Service Layer
	jobService     *service.JobService
	mediaService   *service.MediaService
	aiService      *service.AIService
	convertService *service.ConvertService

	// Delivery Layer
	jobHandler     *delivery.JobHandler
	mediaHandler   *delivery.MediaHandler
	aiHandler      *delivery.AIHandler
	convertHandler *delivery.ConvertHandler

	// Router
	router         http.Handler
}

func NewServer(
	pogo *cache.PogocacheEngine,
	gotenbergLB *worker.GotenbergLoadBalancer,
	downloadDir string,
	frontendDir string,
	mediaLimiter chan struct{},
	httpClient *http.Client,
	httpLongClient *http.Client,
	workerYtdlpURL string,
	workerWhisperURL string,
	workerWhisperFallbackURL string,
	workerRmbgURL string,
	workerRmbgFallbackURL string,
	workerPixelfixerURL string,
	workerPdf2docxURL string,
	workerUpscalerURL string,
) *Server {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	if httpLongClient == nil {
		httpLongClient = httpClient
	}

	workerClient := worker.NewClient(httpClient, httpLongClient)

	jobSvc := service.NewJobService(pogo, downloadDir)
	mediaSvc := service.NewMediaService(pogo, workerClient, mediaLimiter, downloadDir, workerYtdlpURL)
	aiSvc := service.NewAIService(
		workerClient,
		mediaLimiter,
		downloadDir,
		workerWhisperURL,
		workerWhisperFallbackURL,
		workerRmbgURL,
		workerRmbgFallbackURL,
		workerPixelfixerURL,
		workerUpscalerURL,
	)
	convertSvc := service.NewConvertService(gotenbergLB, workerPdf2docxURL, downloadDir, httpClient)

	jobH := delivery.NewJobHandler(
		jobSvc,
		gotenbergLB,
		downloadDir,
		httpClient,
		workerWhisperURL,
		workerWhisperFallbackURL,
		workerRmbgURL,
		workerRmbgFallbackURL,
	)
	mediaH := delivery.NewMediaHandler(mediaSvc)
	aiH := delivery.NewAIHandler(aiSvc, httpClient)
	convertH := delivery.NewConvertHandler(convertSvc)

	router := delivery.NewRouter(delivery.RouterConfig{
		MediaHandler:   mediaH,
		AIHandler:      aiH,
		ConvertHandler: convertH,
		JobHandler:     jobH,
		FrontendDir:    frontendDir,
	})

	return &Server{
		pogo:           pogo,
		gotenbergLB:    gotenbergLB,
		downloadDir:    downloadDir,
		frontendDir:    frontendDir,
		mediaLimiter:   mediaLimiter,
		httpClient:     httpClient,
		httpLongClient: httpLongClient,
		jobService:     jobSvc,
		mediaService:   mediaSvc,
		aiService:      aiSvc,
		convertService: convertSvc,
		jobHandler:     jobH,
		mediaHandler:   mediaH,
		aiHandler:      aiH,
		convertHandler: convertH,
		router:         router,
	}
}

func (s *Server) SetGotenbergLB(lb *worker.GotenbergLoadBalancer) {
	s.gotenbergLB = lb
	s.jobHandler = delivery.NewJobHandler(
		s.jobService,
		lb,
		s.downloadDir,
		s.httpClient,
		"", "", "", "",
	)
}

func (s *Server) SetWorkerURLs(whisperURL, whisperFallbackURL, rmbgURL, rmbgFallbackURL string) {
	workerClient := worker.NewClient(s.httpClient, s.httpLongClient)
	s.aiService = service.NewAIService(
		workerClient,
		s.mediaLimiter,
		s.downloadDir,
		whisperURL,
		whisperFallbackURL,
		rmbgURL,
		rmbgFallbackURL,
		"",
		"",
	)
	s.aiHandler = delivery.NewAIHandler(s.aiService, s.httpClient)
}

// Delegation methods cho HTTP Handlers
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.jobHandler.HandleHealth(w, r)
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	s.mediaHandler.HandleInfo(w, r)
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	s.mediaHandler.HandleDownload(w, r)
}

func (s *Server) handleConvertFile(w http.ResponseWriter, r *http.Request) {
	s.convertHandler.HandleConvertFile(w, r)
}

func (s *Server) handleTranscribe(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandleTranscribe(w, r)
}

func (s *Server) handleRemoveBackground(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandleRemoveBackground(w, r)
}

func (s *Server) handlePixelDetect(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandlePixelDetect(w, r)
}

func (s *Server) handlePixelFix(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandlePixelFix(w, r)
}

func (s *Server) handlePixelHealth(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandlePixelHealth(w, r)
}

func (s *Server) handleUpscale(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandleUpscale(w, r)
}

func (s *Server) handleUpscaleHealth(w http.ResponseWriter, r *http.Request) {
	s.aiHandler.HandleUpscaleHealth(w, r)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.jobHandler.HandleStatus(w, r)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	s.jobHandler.HandleStream(w, r)
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	s.jobHandler.HandleFile(w, r)
}
