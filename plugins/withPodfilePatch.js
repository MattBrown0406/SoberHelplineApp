const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Inserts Xcode 26 / clang 16+ compatibility fixes into the generated Podfile's
 * existing post_install block — directly after the react_native_post_install call.
 *
 * Two fixes:
 *   1. fmt consteval: FMT_STRING uses `consteval` which clang 16+ rejects.
 *      -DFMT_CONSTEVAL= forces the constexpr fallback.
 *   2. Explicit modules: Xcode 26 enables explicit modules by default, which
 *      breaks the dependency-scan phase for many RN pods ("module map not found").
 *      Setting CLANG_ENABLE_EXPLICIT_MODULES = NO on all targets suppresses it.
 *
 * We insert INSIDE the existing block (not as a second post_install) so that
 * all CocoaPods versions see a single hook and react_native_post_install still runs.
 */
module.exports = function withPodfilePatch(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes('# XCODE26_FIXES')) {
        console.log('[withPodfilePatch] Already patched — skipping');
        return config;
      }

      // SDK 52 used an inline ccache expression; SDK 54 extracted it to a helper method.
      // Try both patterns so the plugin survives template changes.
      const rnpiCloseSdk54 = "      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )";
      const rnpiCloseSdk52 = "      :ccache_enabled => podfile_properties['apple.ccacheEnabled'] == 'true',\n    )";

      const hasSdk54 = podfile.includes(rnpiCloseSdk54);
      const hasSdk52 = podfile.includes(rnpiCloseSdk52);
      console.log('[withPodfilePatch] SDK54 pattern found:', hasSdk54);
      console.log('[withPodfilePatch] SDK52 pattern found:', hasSdk52);

      // Also log the react_native_post_install section to diagnose pattern mismatches
      const rnpiIdx = podfile.indexOf('react_native_post_install');
      if (rnpiIdx >= 0) {
        const snippet = podfile.slice(Math.max(0, rnpiIdx - 10), rnpiIdx + 300);
        console.log('[withPodfilePatch] react_native_post_install context:\n' + snippet);
      } else {
        console.warn('[withPodfilePatch] react_native_post_install not found in Podfile at all!');
      }

      const rnpiClose = hasSdk54 ? rnpiCloseSdk54 : hasSdk52 ? rnpiCloseSdk52 : null;

      if (!rnpiClose) {
        console.warn('[withPodfilePatch] Could not find react_native_post_install closing block — skipping patch');
        return config;
      }

      const fixes = rnpiClose + `

    # XCODE26_FIXES — inserted by withPodfilePatch config plugin
    installer.pods_project.targets.each do |target|
      # fmt 11.x: FMT_STRING uses consteval which clang 16+ / Xcode 26 rejects.
      if target.name == 'fmt'
        target.build_configurations.each do |bc|
          bc.build_settings['OTHER_CPLUSPLUSFLAGS'] = '$(inherited) -DFMT_CONSTEVAL='
        end
      end
      # Explicit modules: Xcode 26 enables these by default; they break RN pod
      # dependency scanning with "module map file not found" errors.
      target.build_configurations.each do |bc|
        bc.build_settings['CLANG_ENABLE_EXPLICIT_MODULES'] = 'NO'
      end
    end`;

      podfile = podfile.replace(rnpiClose, fixes);
      fs.writeFileSync(podfilePath, podfile);
      console.log('[withPodfilePatch] Successfully patched Podfile with XCODE26_FIXES');
      return config;
    },
  ]);
};
