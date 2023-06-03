

test-cov: istanbul coveralls


istanbul:
	npx nyc@15 --exclude="_generated_opcua_types.ts" \
			--exclude="./packages/node-opcua-types/**/*.*" \
			--exclude="./packages/node-opcua-utils/**/*.*" \
			--cwd=. node ./packages/run_all_mocha_tests.js  

coveralls:
	npx nyc@15 report --cwd=. \
			--reporter=text-lcov \
		 | npx coveralls --exclude tmp

test-cov-old: istanbul-old coveralls-old

istanbul-old:
	npx nyc@14 --report none --source-map \
			--include="packages/node-opcua-*/dist/**/*.js"  \
			--exclude="packages/node-opcua-*/test/**/*.js"  \
			--exclude-after-remap=false \
			--exclude="_generated_opcua_types.ts" \
			--exclude="packages/node-opcua-types/**/*.*" \
			--exclude="packages/node-opcua-utils/**/*.*" \
			--cwd=. node -max_old_space_size=8192 packages/run_all_mocha_tests.js
coveralls-old: istanbul-old
	npx nyc@14 report --source-map \
			--include="packages/node-opcua*/dist/**/*.js"  \
			--exclude-after-remap=false \
			--cwd=. \
			--reporter=text-lcov \
		 | npx coveralls --exclude tmp


coveralls2: istanbul
	npx nyc@14 report --source-map \
			--include="packages/node-opcua*/dist/**/*.js"  \
			--exclude-after-remap=false \
			--cwd=. \
			--reporter=lcov 

# note a CODECLIMATE_REPO_TOKEN must be specified as an environment variable.
codeclimate: istanbul
	codeclimate-test-reporter < ./coverage/lcov.info


# literate_programming stuff
LP= "../node_modules/.bin/literate-programming"
LP_WIN= "..\\node_modules\\.bin\\literate-programming.cmd"


examples:
	( cd documentation ; $(LP) creating_a_server.md )
	( cd documentation ; $(LP) creating_a_client_typescript.md )
	( cd documentation ; $(LP) creating_a_client_callback.md )
	( cd documentation ; $(LP) create_a_weather_station.md )
	( cd documentation ; $(LP) server_with_da_variables.md )
	( cd documentation ; $(LP) server_with_method.md )

# construct the API javascript documentation
doc: examples
	mkdir -p tmptmp/autogenerated
	node code_gen/makedoc.js  > tmptmp/autogenerated/a.js
	autodoc tmptmp/autogenerated/a.js	
	# jsdoc -v tmptmp/autogenerated/a.js lib/nodeid.js -d=tmptmp/api_doc_js_doc
	yuidoc 

doc1:
	npx yuidocjs
# npx yuidocjs -t node_modules/yuidoc-bootstrap-theme -H node_modules/yuidoc-bootstrap-theme/helpers/helpers.js

yuidoc:
	npm install yuidocjs -g

build_tools:
	npm install minifyjs -g
	npm install browserify -g

build:
	brfy.bat

ug:
	node -e 'var NodeUglifier= require("node-uglifier");(new NodeUglifier("bin/simple_server.js")).uglify().exportToFile("a.js");'
