; The Windows installer. Built by .github/workflows/windows.yml with
;
;     ISCC /DMarkVersion=<version> windows\mark.iss
;
; so the version stays where every other copy of it comes from, Cargo.toml.
;
; Everything here is per-user on purpose: no administrator prompt, no HKLM, and
; nothing outside the current profile. mark is a document viewer, not a service.

#ifndef MarkVersion
  #define MarkVersion "0.0.0"
#endif

[Setup]
; Generated once. Changing it would make the next installer a second
; application rather than an upgrade of this one, and leave the old copy
; installed with no way to reach its uninstaller.
AppId={{4F1C6A2E-9B37-4E58-A0D5-2C7E8B41D9F6}
AppName=mark
AppVersion={#MarkVersion}
AppPublisher=Marcos Venicius
AppPublisherURL=https://github.com/marcos-venicius/mark
AppSupportURL=https://github.com/marcos-venicius/mark/issues
VersionInfoVersion={#MarkVersion}

; Per-user: %LOCALAPPDATA%\Programs is where an application installs itself
; when it is not asking for the machine. PrivilegesRequired=lowest is what
; stops Windows putting up the elevation prompt in the first place.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\mark
DefaultGroupName=mark
DisableProgramGroupPage=yes
DisableDirPage=auto

; x64compatible rather than x64, so this also installs on ARM64 Windows, which
; runs an x64 binary under emulation. It needs Inno Setup 6.3 or newer; on
; anything older ISCC rejects the value outright rather than misreading it.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; The window is WebView2, which is Windows 10 and later. Refusing here is a
; sentence in the installer; letting it through is a program that installs
; cleanly and then does not start.
MinVersion=10.0

; Tells Windows the installer touches file associations, so the shell refreshes
; rather than serving what it cached.
ChangesAssociations=yes

OutputDir=Output
OutputBaseFilename=mark-setup-x64
SetupIconFile=..\assets\mark.ico
UninstallDisplayIcon={app}\mark.exe
UninstallDisplayName=mark
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes

; No LicenseFile: the project declares MIT in Cargo.toml but carries no LICENSE
; file yet. When it grows one, it belongs here.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The binary exactly as cargo built it. The workflow checks these bytes with
; dumpbin -- static CRT, no WebView2Loader, GUI subsystem -- so nothing here
; rewrites or repacks them.
Source: "..\target\release\mark.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\mark"; Filename: "{app}\mark.exe"

[Registry]
; The ProgId: what mark is, how to launch it, and which icon represents a
; document it owns. HKCU rather than HKLM, so none of this needs an
; administrator and an uninstall cannot leave anything behind for other users.
Root: HKCU; Subkey: "Software\Classes\mark.Document"; ValueType: string; ValueName: ""; ValueData: "Markdown document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\mark.Document\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\mark.exe,0"
Root: HKCU; Subkey: "Software\Classes\mark.Document\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\mark.exe"" ""%1"""

; The same command under Applications, which is what puts mark in the "Open
; with" list on its own rather than only behind a ProgId.
Root: HKCU; Subkey: "Software\Classes\Applications\mark.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "mark"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\mark.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\mark.exe"" ""%1"""

; One empty value per extension. OpenWithProgids adds mark to the menu without
; taking the extension over: the value that decides the default is UserChoice,
; which is hash-protected precisely so an installer cannot write it. The reader
; picks mark once, with "Always use this app".
;
; Deliberately not the same list as MARKDOWN_EXTENSIONS in src/main.rs. That one
; includes .txt, because mark will open a text file if asked, but claiming every
; plain text file on the machine in the "Open with" menu is not something a
; Markdown viewer gets to do. `every_registered_extension_is_one_mark_opens` in
; src/main.rs reads these lines and checks the two lists have not drifted.
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mkdn\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mdx\OpenWithProgids"; ValueType: string; ValueName: "mark.Document"; ValueData: ""; Flags: uninsdeletevalue

[Code]
const
  SHCNE_ASSOCCHANGED = $08000000;
  SHCNF_IDLIST = $0000;

procedure SHChangeNotify(wEventId: Integer; uFlags: Cardinal; dwItem1, dwItem2: Cardinal);
  external 'SHChangeNotify@shell32.dll stdcall';

// Writing the keys is not enough on its own: Explorer keeps its own copy of the
// association table and would go on showing the old one until the next sign-in,
// which looks exactly like an installer that did nothing.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
end;
