// v2ray-ext-host: native messaging host for the "Browser v2ray Runner" extension.
//
// Protocol: Chrome/Firefox native messaging — each message is a UTF-8 JSON
// blob prefixed with its length as a 4-byte little-endian uint32, on stdin/stdout.
//
// Responsibilities:
//   - Receive a ready-made sing-box JSON config from the extension
//   - Write it to disk and (re)start the sing-box process as a child process
//   - Report status / errors back to the extension
//   - Stop the process on "stop" command or when stdin closes (browser killed us)
//
// No third-party dependencies — stdlib only — so it builds offline.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type inMsg struct {
	Action   string          `json:"action"`
	Config   json.RawMessage `json:"config,omitempty"`
	TestPort int             `json:"test_port,omitempty"`
}

type outMsg struct {
	OK        bool   `json:"ok"`
	Status    string `json:"status,omitempty"` // "running" | "stopped"
	Error     string `json:"error,omitempty"`
	Message   string `json:"message,omitempty"`
	LatencyMs int64  `json:"latency_ms,omitempty"`
}

var (
	mu         sync.Mutex
	cmd        *exec.Cmd
	installDir string
	corePath   string
	configPath string
	logPath    string
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fail("cannot resolve own path: " + err.Error())
	}
	installDir = filepath.Dir(exe)
	corePath = filepath.Join(installDir, "sing-box.exe")
	configPath = filepath.Join(installDir, "active-config.json")
	logPath = filepath.Join(installDir, "sing-box.log")

	reader := bufio.NewReader(os.Stdin)
	for {
		msg, err := readMessage(reader)
		if err != nil {
			// stdin closed -> browser disconnected us; clean up and exit.
			stopCore()
			return
		}

		var in inMsg
		if err := json.Unmarshal(msg, &in); err != nil {
			writeMessage(outMsg{OK: false, Error: "bad request: " + err.Error()})
			continue
		}

		switch in.Action {
		case "start":
			handleStart(in.Config)
		case "stop":
			stopCore()
			writeMessage(outMsg{OK: true, Status: "stopped"})
		case "status":
			writeMessage(outMsg{OK: true, Status: statusStr()})
		case "test":
			handleTest(in.Config)
		default:
			writeMessage(outMsg{OK: false, Error: "unknown action: " + in.Action})
		}
	}
}

func handleStart(cfg json.RawMessage) {
	mu.Lock()
	defer mu.Unlock()

	if len(cfg) == 0 {
		writeMessageLocked(outMsg{OK: false, Error: "missing config"})
		return
	}
	if _, err := os.Stat(corePath); err != nil {
		writeMessageLocked(outMsg{OK: false, Error: "sing-box.exe not found next to host — reinstall"})
		return
	}

	if err := os.WriteFile(configPath, cfg, 0o600); err != nil {
		writeMessageLocked(outMsg{OK: false, Error: "cannot write config: " + err.Error()})
		return
	}

	stopLocked()

	logFile, err := os.Create(logPath)
	if err != nil {
		writeMessageLocked(outMsg{OK: false, Error: "cannot open log file: " + err.Error()})
		return
	}

	c := exec.Command(corePath, "run", "-c", configPath)
	c.Dir = installDir
	c.Stdout = logFile
	c.Stderr = logFile
	hideWindow(c)

	if err := c.Start(); err != nil {
		writeMessageLocked(outMsg{OK: false, Error: "cannot start sing-box: " + err.Error()})
		return
	}
	cmd = c

	go func(c *exec.Cmd) {
		_ = c.Wait()
		mu.Lock()
		if cmd == c {
			cmd = nil
		}
		mu.Unlock()
	}(c)

	writeMessageLocked(outMsg{OK: true, Status: "running", Message: "sing-box started"})
}

const testLatencyURL = "https://www.gstatic.com/generate_204"
const testStartupWait = 900 * time.Millisecond
const testOverallTimeout = 16 * time.Second

// handleTest runs entirely independently of the main `cmd` / mu state above:
// it's a separate throwaway sing-box process on its own port, torn down
// before this function returns. It never touches the user's active
// connection (if any is running in a different native-host process).
func handleTest(cfg json.RawMessage) {
	if len(cfg) == 0 {
		writeMessage(outMsg{OK: false, Error: "missing config"})
		return
	}
	if _, err := os.Stat(corePath); err != nil {
		writeMessage(outMsg{OK: false, Error: "sing-box.exe not found next to host — reinstall"})
		return
	}

	testCfgPath := filepath.Join(installDir, fmt.Sprintf("test-config-%d.json", os.Getpid()))
	if err := os.WriteFile(testCfgPath, cfg, 0o600); err != nil {
		writeMessage(outMsg{OK: false, Error: "cannot write test config: " + err.Error()})
		return
	}
	defer os.Remove(testCfgPath)

	var testPortI int
	var probe struct {
		Inbounds []struct {
			ListenPort int `json:"listen_port"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(cfg, &probe); err == nil && len(probe.Inbounds) > 0 {
		testPortI = probe.Inbounds[0].ListenPort
	}
	if testPortI == 0 {
		writeMessage(outMsg{OK: false, Error: "test config has no inbound port"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), testOverallTimeout)
	defer cancel()

	c := exec.CommandContext(ctx, corePath, "run", "-c", testCfgPath)
	c.Dir = installDir
	hideWindow(c)
	if err := c.Start(); err != nil {
		writeMessage(outMsg{OK: false, Error: "cannot start test sing-box: " + err.Error()})
		return
	}
	defer func() {
		if c.Process != nil {
			_ = c.Process.Kill()
		}
		_ = c.Wait()
	}()

	time.Sleep(testStartupWait)

	start := time.Now()
	err := probeThroughSocks5("127.0.0.1:"+strconv.Itoa(testPortI), testLatencyURL, 8*time.Second)
	elapsed := time.Since(start)

	if err != nil {
		writeMessage(outMsg{OK: false, Error: err.Error()})
		return
	}
	writeMessage(outMsg{OK: true, LatencyMs: elapsed.Milliseconds()})
}

// probeThroughSocks5 does a minimal SOCKS5 (no-auth, CONNECT) handshake to
// reach proxyAddr, then an HTTP GET over that tunnel via net/http's dialer
// hook — avoids any third-party SOCKS package so the build stays dependency-free.
func probeThroughSocks5(proxyAddr, targetURL string, timeout time.Duration) error {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return socks5Connect(ctx, proxyAddr, addr)
		},
	}
	client := &http.Client{Transport: transport, Timeout: timeout}
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("درخواست از طریق پروکسی ناموفق بود: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("سرور مقصد خطای %d برگردوند", resp.StatusCode)
	}
	return nil
}

func socks5Connect(ctx context.Context, proxyAddr, targetAddr string) (net.Conn, error) {
	d := net.Dialer{}
	conn, err := d.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, fmt.Errorf("اتصال به sing-box محلی ناموفق بود: %v", err)
	}

	host, portStr, err := net.SplitHostPort(targetAddr)
	if err != nil {
		conn.Close()
		return nil, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		conn.Close()
		return nil, err
	}

	// greeting: no-auth only
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		conn.Close()
		return nil, err
	}
	reply := make([]byte, 2)
	if _, err := io.ReadFull(conn, reply); err != nil || reply[0] != 0x05 || reply[1] != 0x00 {
		conn.Close()
		return nil, fmt.Errorf("پاسخ SOCKS5 نامعتبر")
	}

	// CONNECT request, domain-name address type
	var buf bytes.Buffer
	buf.Write([]byte{0x05, 0x01, 0x00, 0x03})
	buf.WriteByte(byte(len(host)))
	buf.WriteString(host)
	portBytes := make([]byte, 2)
	binary.BigEndian.PutUint16(portBytes, uint16(port))
	buf.Write(portBytes)
	if _, err := conn.Write(buf.Bytes()); err != nil {
		conn.Close()
		return nil, err
	}

	connReply := make([]byte, 4)
	if _, err := io.ReadFull(conn, connReply); err != nil {
		conn.Close()
		return nil, err
	}
	if connReply[1] != 0x00 {
		conn.Close()
		return nil, fmt.Errorf("SOCKS5 اتصال رو رد کرد (کد %d)", connReply[1])
	}
	// consume the bound address in the reply (var length depending on ATYP)
	switch connReply[3] {
	case 0x01: // IPv4
		io.CopyN(io.Discard, conn, 4+2)
	case 0x03: // domain
		lenByte := make([]byte, 1)
		io.ReadFull(conn, lenByte)
		io.CopyN(io.Discard, conn, int64(lenByte[0])+2)
	case 0x04: // IPv6
		io.CopyN(io.Discard, conn, 16+2)
	}

	return conn, nil
}

func stopCore() {
	mu.Lock()
	defer mu.Unlock()
	stopLocked()
}

func stopLocked() {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		cmd = nil
	}
}

func statusStr() string {
	mu.Lock()
	defer mu.Unlock()
	if cmd != nil {
		return "running"
	}
	return "stopped"
}

// --- native messaging framing ---

func readMessage(r *bufio.Reader) ([]byte, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

var writeMu sync.Mutex

func writeMessage(m outMsg) {
	writeMu.Lock()
	defer writeMu.Unlock()
	writeRaw(m)
}

// used when caller already holds `mu` — writing itself only needs writeMu
func writeMessageLocked(m outMsg) {
	writeMu.Lock()
	defer writeMu.Unlock()
	writeRaw(m)
}

func writeRaw(m outMsg) {
	b, _ := json.Marshal(m)
	length := uint32(len(b))
	_ = binary.Write(os.Stdout, binary.LittleEndian, length)
	_, _ = os.Stdout.Write(b)
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "v2ray-ext-host fatal: "+msg)
	os.Exit(1)
}
