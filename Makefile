test-cov: istanbul

istanbul:
	istanbul cover ./node_modules/mocha/bin/_mocha -- -R spec test --recursive

coveralls:
	cat ./coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js


# construct the API javascript documentation
doc: lib/a.js 
	mkdir tmptmp/autogenerated
	node code_gen/makedoc.js  > tmptmp/autogenerated/a.js
	autodoc tmptmp/autogenerated/a.js
	jsdoc -v tmptmp/autogenerated/a.js lib/nodeid.js -d=tttt
	yuidoc 
