Pod::Spec.new do |s|
  s.name = 'ParentNotificationActions'
  s.version = '1.0.0'
  s.summary = 'Football Player invitation notification actions'
  s.description = 'Executes authenticated invitation responses without presenting the app.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Football Player'
  s.homepage = 'https://footballplayer.online'
  s.platform = :ios, '15.1'
  s.source = { :git => 'https://github.com/Hype76/footballdev.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'EXNotifications'
  s.dependency 'EXTaskManager'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
end
