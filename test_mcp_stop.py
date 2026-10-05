"""Stop must cancel a reference worker waiting to retry. No real processes killed."""
import unittest
from unittest.mock import Mock, patch
from mcp_client import MCPClient


class StopTests(unittest.TestCase):
    def test_windows_stops_owned_process_tree(self):
        client = MCPClient("mcp_server.js")
        client.proc = Mock(pid=12345)
        client.proc.poll.return_value = None
        with patch("mcp_client.os.name", "nt"), patch("mcp_client.subprocess.run") as run:
            client.stop()
        self.assertEqual(run.call_args.args[0], ["taskkill", "/PID", "12345", "/T", "/F"])
        self.assertIsNone(client.proc)

    def test_already_finished_does_not_kill(self):
        client = MCPClient("mcp_server.js")
        client.proc = Mock(pid=12345)
        client.proc.poll.return_value = 0
        with patch("mcp_client.subprocess.run") as run:
            client.stop()
        run.assert_not_called()
        self.assertIsNone(client.proc)


if __name__ == "__main__":
    unittest.main()
