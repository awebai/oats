## Changed

- **OATS Desktop's Add a machine dialog no longer suggests a folder**
  ([#1390](https://github.com/awebai/oats/issues/1390)). **Folder on that
  machine** starts empty and you have to fill it in. Its hint reads "A path on
  that machine, starting with / or ~/". If you click **Add machine** with the
  folder empty, the dialog says so beside the field and runs nothing. It used
  to fill in `~/Agents/<deployment folder name>`. The Name default
  (`<host>-<deployment folder name>`) is unchanged.
