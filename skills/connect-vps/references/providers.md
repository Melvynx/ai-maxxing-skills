Where each provider keeps the VPS details and the SSH keys. Panels change their labels often: treat every path here as "usually", read the page with `snapshotForAI()` and search for words like "SSH", "Keys", "Access", "Settings" or "Security" when a label moved.

Two kinds of providers matter for the key. Some add a key to a server that already runs: add it in the panel and test. Most only put keys on a server at creation or reinstall: never reinstall a server the user already uses, have the user copy the key over with their root password instead (step 5 of the skill).

Hostinger: panel `https://hpanel.hostinger.com`, then VPS in the left menu and Manage on the server. The overview shows the IP, the OS and the SSH user (`root`). Keys live in Settings, tab "SSH keys", button "Add SSH key": paste the public key, give it the alias as name. It applies to the running server, usually within a minute. The root password, if needed, is in Settings too ("Root access" or "Change root password"); the user sets it themselves.

Hetzner Cloud: panel `https://console.hetzner.cloud`, pick the project, then the server. The IP is at the top, the user is `root`. The "Security", "SSH keys" page of the project only applies to new servers, so on an existing one use the root password: it came by email at creation, or the user resets it in the server's "Rescue" tab, "Reset root password". Hetzner Robot (dedicated servers, `https://robot.hetzner.com`) works the same way.

Netcup: the order details are in the Customer Control Panel `https://www.customercontrolpanel.de`, the server itself in the Server Control Panel `https://www.servercontrolpanel.de`. The IP and the root password came in the setup email; the user is `root`. Keys are only taken when installing an image, so use the root password.

OVHcloud: panel `https://www.ovh.com/manager`, Bare Metal Cloud, Virtual private servers, then the server. The IP is on the home tab. The user is usually `ubuntu` or `debian` (the OS name), not `root`, with a password from the setup email. Keys only apply on reinstall, so use the password.

DigitalOcean: panel `https://cloud.digitalocean.com/droplets`, then the droplet. The IP is at the top, the user is `root`. Keys in Settings, Security only apply to new droplets; on an existing one use the root password, or the user resets it in the droplet's "Access" tab.

Contabo: panel `https://my.contabo.com`, Your services, VPS. The IP and the user (`root`) are in the list; the root password is the one the user chose at order (it can be reset there, "Password reset"). Keys only apply on reinstall, so use the password.

PrivateAlps and any other provider: open the provider's site, find the client area, then the server page. Look for the IP, the login user (often `root`) and a section about SSH keys or access. If the panel only lets you add keys to new servers, use the root password path. If you cannot find the IP, ask the user to look at the welcome email from the provider.
