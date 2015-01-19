module.exports = function(grunt) {
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-githooks');

  grunt.initConfig({
    eslint: {
      options: {
        config: '.eslintrc'
      },
      target: [
        'lib/**/*.js',
        'test/**/*.js'
      ]
    },
    mochaTest: {
      test: {
        options: {
          reporter: 'spec'
        },
        src: ['test/**/*.js']
      }
    },
    githooks: {
      all: {
        'pre-commit': 'eslint',
      }
    }
  });

  grunt.registerTask('default', ['eslint']);
  grunt.registerTask('test', ['eslint', 'mochaTest']);
};
