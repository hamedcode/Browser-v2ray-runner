//go:build !windows

package main

import "os/exec"

func hideWindow(c *exec.Cmd) {}
