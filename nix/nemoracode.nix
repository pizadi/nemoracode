{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  wayland,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node_modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "nemoracode";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  postPatch = ''
    # NOTE: Relax Bun version check to be a warning instead of an error
    substituteInPlace packages/script/src/index.ts \
      --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                     'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
  '';

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.NEMORACODE_DISABLE_MODELS_FETCH = true;
  env.NEMORACODE_VERSION = finalAttrs.version;
  env.NEMORACODE_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cli-*/bin/nemoracode $out/bin/nemoracode

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/nemoracode \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } ${lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
      ''}

    ln -s nemoracode $out/bin/nemoracode2

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    $out/bin/nemoracode --completions bash > nemoracode.bash
    $out/bin/nemoracode --completions zsh > _nemoracode
    $out/bin/nemoracode --completions fish > nemoracode.fish

    installShellCompletion --cmd nemoracode \
      --bash nemoracode.bash \
      --fish nemoracode.fish \
      --zsh _nemoracode

    # NEMORACODE_CLI_NAME is a build-time define, so the nemoracode2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase nemoracode that later appears in a
    # description or help text ships as nemoracode2 in the nemoracode2 copy.
    substitute nemoracode.bash nemoracode2.bash --replace-fail nemoracode nemoracode2
    substitute _nemoracode _nemoracode2 --replace-fail nemoracode nemoracode2
    substitute nemoracode.fish nemoracode2.fish --replace-fail nemoracode nemoracode2

    installShellCompletion --cmd nemoracode2 \
      --bash nemoracode2.bash \
      --fish nemoracode2.fish \
      --zsh _nemoracode2
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "NEMORACODE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "nemoracode";
    inherit (node_modules.meta) platforms;
  };
})
