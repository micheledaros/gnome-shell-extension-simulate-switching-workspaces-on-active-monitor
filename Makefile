clean:
	rm -rf simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/
	rm -rf simulate-switching-workspaces-on-active-monitor@micheledaros.com/node_modules

schemas:
	mkdir -p simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/schemas
	glib-compile-schemas --targetdir=simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/schemas/ simulate-switching-workspaces-on-active-monitor@micheledaros.com/schemas/

build:
	cd simulate-switching-workspaces-on-active-monitor@micheledaros.com/ && npm ci && npm run build

copy-assets:
	mkdir -p simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/
	cp simulate-switching-workspaces-on-active-monitor@micheledaros.com/metadata.json simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/

submit: schemas build copy-assets
	cd simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/ && zip -r ~/simulate-switching-workspaces-on-active-monitor.zip *

install: schemas build copy-assets
	rm -rf ~/.local/share/gnome-shell/extensions/simulate-switching-workspaces-on-active-monitor@micheledaros.com/
	cp -r simulate-switching-workspaces-on-active-monitor@micheledaros.com/dist/ ~/.local/share/gnome-shell/extensions/simulate-switching-workspaces-on-active-monitor@micheledaros.com/
